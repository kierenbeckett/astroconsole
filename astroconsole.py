import argparse
import asyncio
import json
import pathlib
import sys
import xml.etree.ElementTree as ET

from aiohttp import web
from collections import defaultdict
from datetime import datetime, timezone

indi_state = {}
indi_state['devices'] = defaultdict(dict)
indi_state['devices']['proxy'] = {
    'CONNECTION': {
        'device': 'proxy',
        'name': 'CONNECTION',
        'state': 'Ok',
        'keys': [{'key': 'CONNECT', 'value': False}]
    }
}
clients = set()


async def indi_connect(host, port):
    while True:
        writer = None
        try:
            print(f'Connecting to INDI at {host}:{port}...')
            reader, writer = await asyncio.open_connection(host, port)
            print(f'Connected to INDI, getting properties')
            indi_state['writer'] = writer
            indi_state['devices']['proxy']['CONNECTION']['keys'][0]['value'] = True
            await broadcast_json(indi_state['devices']['proxy']['CONNECTION'])
            writer.write(f'<getProperties version="1.7" />'.encode('ascii'))

            parser = ET.XMLPullParser(events=['start', 'end'])
            root_element = None

            while True:
                data = await reader.readline()
                if not data:
                    print('Disconnected from INDI')
                    break

                parser.feed(data)

                for event, elem in parser.read_events():
                    if root_element == None and event == 'start':
                        root_element = elem.tag
                    elif elem.tag == root_element and event == 'end':
                        if elem.tag == 'message':
                            print(f'INDI message {elem.get('device')}: {elem.get('message')}')
                        elif elem.tag == 'defNumberVector' or elem.tag == 'setNumberVector':
                            prop = {
                                'device': elem.get('device'),
                                'name': elem.get('name'),
                                'state': elem.get('state'),
                                'keys': [{'key': n.get('name'), 'value': float(n.text)} for n in elem.findall('defNumber') + elem.findall('oneNumber')],
                            }
                            if elem.get('device') not in indi_state['devices']:
                                indi_state['devices'][elem.get('device')] = {}
                            indi_state['devices'][elem.get('device')][elem.get('name')] = prop
                            await broadcast_json(prop)
                        elif elem.tag == 'defSwitchVector' or elem.tag == 'setSwitchVector':
                            if elem.get('name') == 'CONNECTION' and elem.get('state') == 'Idle':
                                print(f'Requesting INDI connect to {elem.get('device')}')
                                writer.write(f'<newSwitchVector device="{elem.get('device')}" name="CONNECTION"><oneSwitch name="CONNECT">On</oneSwitch></newSwitchVector>'.encode('ascii'))

                            prop = {
                                'device': elem.get('device'),
                                'name': elem.get('name'),
                                'state': elem.get('state'),
                                'keys': [{'key': n.get('name'), 'value': n.text.strip() == 'On'} for n in elem.findall('defSwitch') + elem.findall('oneSwitch')],
                            }
                            indi_state['devices'][elem.get('device')][elem.get('name')] = prop
                            await broadcast_json(prop)
                        parser = ET.XMLPullParser(events=['start', 'end'])
                        root_element = None
        except Exception as e:
            print(f'Error with INDI connection "{e}"')
        finally:
            if writer is not None:
                writer.close()

        print('Reconnecting to INDI in 10 seconds')
        just_disconnected = indi_state.pop('writer', None) is not None
        if just_disconnected:
            indi_state['devices'] = defaultdict(dict, {'proxy': indi_state['devices']['proxy']})
            indi_state['devices']['proxy']['CONNECTION']['keys'][0]['value'] = False
            await broadcast_json(indi_state['devices']['proxy']['CONNECTION'])
        await asyncio.sleep(10)


async def broadcast_json(obj):
    if clients:
        msg = json.dumps(obj)
        try:
            await asyncio.gather(*(ws.send_str(msg) for ws in clients))
        except Exception as e:
            print(f'Error broadcasting to websockets "{e}"')


async def handle_client(request, config):
    try:
        websocket = web.WebSocketResponse()
        await websocket.prepare(request)

        clients.add(websocket)
        print(f'Accepted connection from {request.transport.get_extra_info('peername')}')

        if pathlib.Path(config).exists():
            with open(config) as f:
                await websocket.send_str(f.read())
        else:
            await websocket.send_str(json.dumps({'devices': {}}))

        for k, v in indi_state['devices'].items():
            for prop in v.values():
                await websocket.send_str(json.dumps(prop))

        async for message in websocket:
            if message.type == web.WSMsgType.TEXT:
                data = json.loads(message.data)

                if data['cmd'] == 'switch':
                    keys = ''.join([f'<oneSwitch name="{k['key']}">{'On' if k['value'] else 'Off'}</oneSwitch>' for k in data['keys']])
                    indi_state['writer'].write(f'<newSwitchVector device="{data['device']}" name="{data['name']}">{keys}</newSwitchVector>'.encode('ascii'))

                elif data['cmd'] == 'number':
                    keys = ''.join([f'<oneNumber name="{k['key']}">{k['value']}</oneNumber>' for k in data['keys']])
                    indi_state['writer'].write(f'<newNumberVector device="{data['device']}" name="{data['name']}">{keys}</newNumberVector>'.encode('ascii'))

                elif data['cmd'] == 'config':
                    with open(config, 'w') as f:
                        json.dump(data['config'], f, indent=4)

                else:
                    print(f'Unknown command {data['cmd']}')
            elif msg.type == web.WSMsgType.ERROR:
                print(f'Error with websocket "{websocket.exception()}"')
    except Exception as e:
        print(f'Error handling client connection "{e}"')
    finally:
        print(f'Disconnected from {request.transport.get_extra_info('peername')}')
        clients.remove(websocket)

    return websocket


async def root(request):
    return web.FileResponse("www/index.html")


async def start_webserver(host, port, config):
    app = web.Application()
    app.router.add_get("/", root)
    app.router.add_get("/ws", lambda ws: handle_client(ws, config))
    app.router.add_static("/", path="www", name="www")
    runner = web.AppRunner(app)
    await runner.setup()
    print(f'Websocket server listening on {host}:{port}')
    site = web.TCPSite(runner, host, port)
    await site.start()


async def main(args):
    if pathlib.Path(args.config).exists():
        with open(args.config) as f:
            cfg = json.load(f)
    else:
        cfg = {}

    host = cfg.get("webui", {}).get("host", "0.0.0.0")
    port = cfg.get("webui", {}).get("port", 8080)
    indi_host = cfg.get("indi", {}).get("host", "127.0.0.1")
    indi_port = cfg.get("indi", {}).get("port", 7624)

    await asyncio.gather(
        start_webserver(host, port, args.config),
        indi_connect(indi_host, indi_port)
    )


if __name__ == '__main__':
    sys.stdout.reconfigure(line_buffering=True)

    parser = argparse.ArgumentParser(description='AstroConsole')

    parser.add_argument(
        '--config',
        default='/etc/astroconsole/astroconsole.json',
        help='Location of config file (default: /etc/astroconsole/astroconsole.json)'
    )

    try:
        asyncio.run(main(parser.parse_args()))
    except KeyboardInterrupt:
        print('Terminating')
