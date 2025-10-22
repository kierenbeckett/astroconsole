# AstroConsole

![AstroConsole Logo](www/android-chrome-192x192.png)

AstroConsole allows you to control your telescope mount and focuser from any web browser. Simply install AstroConsole, connect it to your devices and visit the web UI.

![Screenshot](docs/screenshot.png)

It also has the following features:

* Digital Finderscope - Mount any UVC webcam on your scope and view it from AstroConsole.
* Gamepad Support - Connect a gamepad to your mobile and use it to control your telescope.
* Lightweight - Can be installed on a Raspberry Pi Zero 2

![Mobile Gamepad](docs/mobile_gamepad.png)

## Quick Start

On the computer connected to your devices, normally this would be a Raspberry Pi or similar but could be your laptop:

* Ensure you have INDI server running and connected to a mount and/or focuser.
* Download the [latest release](https://github.com/kierenbeckett/astroconsole/releases/latest/download/astroconsole.deb)
* Install it with `apt install ./astroconsole.deb`.

On the computer you want to control the telescope from, normally a mobile or tablet:

* Visit the web UI at `http://yourip:8080`.

## Config

Config can be added to `/etc/astroconsole/astroconsole.json`

```
{
    "webui": {
        "host": "0.0.0.0",
        "port": 8080,
        "leftHanded": false
    },
    "indi": {
        "host": "127.0.0.1",
        "port": 7624
    },
    "devices": {
        "EQMod Mount": {
            "reverseRa": true,
            "reverseDecPierWest": false,
            "reverseDecPierEast": true
        },
        "ZWO EAF": {
            "presets": {
                "Camera with 2x Barlow": 28550,
                "Camera": 30850,
                "Eyepiece": 46850
            },
            "backlashComp": 50
        }
    },
    "mount": {
      "name": "EQMod Mount"
    },
    "focuser": {
      "name": "ZWO EAF"
    },
    "finderscope": {
        "url": "http://yourip:8081/",
        "fovx": 5,
        "fovy": 3,
        "rotation": 0,
        "flipPierEast": true
    },
    "camera": {
        "fovx": 1,
        "fovy": 0.5,
        "rotation": 0,
        "flipPierEast": true
    },
    "gamepad": {
        "directionX": 2,
        "directionY": 3,
        "directionUp": 12,
        "directionDown": 13,
        "directionLeft": 14,
        "directionRight": 15,
        "focusInSmall": 4,
        "focusOutSmall": 5,
        "focusInLarge": 6,
        "focusOutLarge": 7
    }
}
```

| Path                                     | Type      | Default      | Description |
|------------------------------------------|-----------|--------------|-------------|
| webui.host                               | string    | 0.0.0.0      | Host to bind to for web UI |
| webui.port                               | number    | 8080         | Port to listen on for the web UI |
| webui.leftHanded                         | boolean   | false        | Flip the controls so they are easier to reach left handed |
| indi.host                                | string    | 127.0.0.1    | The INDI server host to connect to |
| indi.port                                | number    | 7624         | The INDI server port to connect to |
| devices.${mount_name}.reverseRa          | boolean   | false        | Reverse left/right buttons |
| devices.${mount_name}.reverseDecPierWest | boolean   | false        | Reverse up/down buttons when the pier side is west (pointing east) |
| devices.${mount_name}.reverseDecPierEast | boolean   | false        | Reverse up/down buttons when the pier side is east (pointing west) |
| devices.${focuser_name}.presets          | map       | {}           | A map of focuser presets to jump to, friendly name => focuser value |
| devices.${focuser_name}.backlashComp     | map       | 0            | When focusing outward, overshoot by the given amount then correct with an inward focus to compensate for backlash |
| mount.name                               | string    | *Autodetect* | The INDI device name for the mount, if not specified the first one seen will be used |
| focuser.name                             | string    | *Autodetect* | The INDI device name for the focuser, if not specified the first one seen will be used |
| finderscope.url                          | string    | *Simulate*   | The URL of a video feed to a webcam being used as a finderscope, see below |
| finderscope.fovx                         | number    | *null*       | The horizontal FOV of your finderscope in decimal degrees, used to draw FOV squares |
| finderscope.fovy                         | number    | *null*       | The vertical FOV of your finderscope in decimal degrees, used to draw FOV squares |
| finderscope.rotation                     | number    | 0            | The rotation of your finderscope on your rig, so the UI can match, see below |
| finderscope.flipPierEast                 | boolean   | false        | Whether the rotation of your finderscope should be flipped when the pier side is east (pointing west) |
| camera.fovx                              | number    | *null*       | The horizontal FOV of your camera in decimal degrees, used to draw FOV squares |
| camera.fovy                              | number    | *null*       | The vertical FOV of your camera in decimal degrees, used to draw FOV squares |
| camera.rotation                          | number    | 0            | The rotation of your camera on your rig, so the UI can match, see below |
| camera.flipPierEast                      | boolean   | false        | Whether the rotation of your camera should be flipped when the pier side is east (pointing west) |
| gamepad.directionX                       | number    | 2            | The ID of the X axis of an analogue stick to control direction, defaults to what is normally the right stick |
| gamepad.directionY                       | number    | 3            | The ID of the Y axis of an analogue stick to control direction, defaults to what is normally the right stick |
| gamepad.directionUp                      | number    | 12           | The ID of the button to move up, defaults to what is normally the dpad |
| gamepad.directionDown                    | number    | 13           | The ID of the button to move down, defaults to what is normally the dpad |
| gamepad.directionLeft                    | number    | 14           | The ID of the button to move left, defaults to what is normally the dpad |
| gamepad.directionRight                   | number    | 15           | The ID of the button to move right, defaults to what is normally the dpad |
| gamepad.focusInSmall                     | number    | 4            | The ID of the button to focus inward a small amount, defaults to what is normally the left shoulder button |
| gamepad.focusOutSmall                    | number    | 5            | The ID of the button to focus outward a small amount, defaults to what is normally the right shoulder button |
| gamepad.focusInLarge                     | number    | 6            | The ID of the button to focus inward a large amount, defaults to what is normally the left trigger |
| gamepad.focusOutLarge                    | number    | 7            | The ID of the button to focus outward a large amount, defaults to what is normally the right trigger |

Note that some properties need their INDI device name including e.g. `devices.${mount_name}.reverseRa` might be `devices."EQMod Mount".reverseRa`. This allows multiple mounts/focusers to be used without needing to change the config file each time.

Changes to most config takes effect when reloading the web UI. You only need to restart AstroConsole when changing the webui or indi host/port.

### Finderscope Webcam

AstroConsole supports the use of a webcam as a digital finderscope. Your webcam needs to be streamable over HTTP, set the URL to your webcam using `finderscope.url`. If you do not set a URL, a catalogue image is shown.

If you are running AstroConsole on a Pi you can plug a webcam into the Pi and install [µStreamer](https://github.com/pikvm/ustreamer) to make it available over HTTP.

### Aligning the Direction of Devices

All the devices in AstroConsole should be aligned such that up is towards the north celestial pole. Configure your devices in the following order:

**Mount Up/Down/Left/Right**

* Move your mount to point east, low on the horizon.
* Press left and the mount should pan left, if it pans right set `devices.${mount_name}.reverseRa=true`.
* Press up and the mount should pan up, if it pans down set `devices.${mount_name}.reverseDecPierWest=true`.
* Move your mount to point west, low on the horizon.
* Press up and the mount should pan up, if it pans down set `devices.${mount_name}.reverseDecPierEast=true`.

**Finderscope and Camera**

* Move your mount to point east, low on the horizon.
* If your finderscope is upright in this position leave `finderscope.rotation=0`.
* If your finderscope is rotated clockwise 90 degrees set `finderscope.rotation=90`.
* Reload AstroConsole, pressing left/up should pan left/up in the finderscope view.
* Move your mount to point west, low on the horizon.
* Normally at this point your finderscope will have flipped by 180, if so set `finderscope.flipPierEast=true`.
* Repeat for your camera if required.

### Gamepad Support

AstroConsole supports controlling both the mount and focuser using a gamepad. The default mapping is shown below:

![Gamepad Mapping](docs/gamepad.png)

Buttons can be re-mapped via the configuration above. To verify that your gamepad is compatible and to confirm the button IDs, you can use [this site](https://hardwaretester.com/gamepad).

The four directional buttons on the gamepad function the same way as the on-screen UI buttons: press to move and release to stop, using the rate set on the slider. The analog stick additionally supports variable rates: pushing the stick to the edge will use the full rate set on the slider, while partially deflecting the stick will use half that rate.

## FAQs

### What mounts and focusers are supported?

In theory any mount/focuser supported by INDI should work. So far it has only been tested on the EQMod and ZWO EAF drivers. If it works for your device please let me know.

### How do I run INDI server?

There are many ways to run INDI server:

* Have [Kstars/Ekos](https://kstars.kde.org/) run it for you.
* Setup [Astroberry](https://www.astroberry.io/).
* Use [INDI Web Manager](https://github.com/knro/indiwebmanager).
* Run it directly via systemd.

I recommend installing INDI and AstroConsole on a Raspberry Pi (even a Zero 2 will do) and then using systemd to run them both automatically. The easiest path to installing INDI on the Pi is to install Ubuntu and then use the following package repo:

```
sudo apt-add-repository ppa:mutlaqja/ppa
sudo apt install indi-full
```

### How do I set my mount location, or other device settings?

You can set properties of your devices using `indi_setprop`, for example to set your location:

```
indi_setprop "EQMod Mount.GEOGRAPHIC_COORD.LAT=64.5;LONG=340.75;ELEV=100"
```

Latitude is between -90 and 90, longitude is between 0 and 360 where 20 east would be 20 and 20 west would be 340. Both are decimal

To set an EQMod Mount's USB device and baud rate:

```
indi_setprop "EQMod Mount.DEVICE_PORT.PORT=/dev/serial/by-id/my-webcam-name-port0"
indi_setprop "EQMod Mount.DEVICE_BAUD_RATE.115200=On"
```

To check they are set run `indi_getprop`, for example `indi_getprop "EQMod Mount.GEOGRAPHIC_COORD.*"`.

### What IP should I use to see the web UI?

The IP address needs to be a local one, rather than your public IP.

Normally, you would run AstroConsole on a Raspberry Pi that is connected to the same Wi-Fi network as your laptop or mobile. In this case, use the local IP address of the Pi, often something like `192.168.x.x` or `10.10.x.x`.

If you are running AstroConsole on the same laptop you are accessing it from, you can use `127.0.0.1`.

### Can I access the web UI over the internet?

With additional tools, yes.

⚠️  **Do not expose AstroConsole directly to the internet via your router’s port forwarding.** It does not have authentication and has not been security-hardened.

* Use a VPN such as [Tailscale](https://tailscale.com/) or [WireGuard](https://www.wireguard.com/) to access your internal network remotely, then use the local IP as above.  
* Proxy the web UI using a tunnel service such as [Ngrok](https://ngrok.com/) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). Make sure you configure some authentication.

### How can I control my main camera?

AstroConsole is primarily to assist with visual astronomy and does not support controlling your main camera. When doing planetary or DSO imaging you can connect a laptop with desktop software such as FireCapture or Ekos directly to your main camera. You can connect the desktop software to your mount/focuser via the same INDI server as AstroConsole:

```mermaid
flowchart LR
    C[Camera]
    M[Mount]
    F[Focuser]
    PI[Pi, INDI+AstroConsole]
    P[Phone]
    L[Laptop, FireCapture / Ekos+INDI]

    PI ---|USB| M
    PI ---|USB| F
    P ---|Wi-Fi| PI
    L ---|USB| C
    L ---|Wi-Fi| PI
```

This way you always have mount/focuser control via AstroConsole and can quickly swap from visual to a full imaging setup, without having to recalibrate your mount.

To connect Ekos to your camera directly and to your mount/focuser via the INDI used by AstronConsole you can use INDI chaining as follows:

![EKOS Remote](docs/ekosremote.png)

Where the IP in the remote field is the IP of your Pi.

### What frame of reference are the RA/Dec coordinates in?

The coordinates returned by the mount are shown as-is, they are expected to be JNow[^1].

[^1]: **JNow** — Topocentric equatorial coordinates using the equinox of date (i.e. the RA/Dec you would expect after polar alignment, before any additional transformation).

## Author

© 2025 [Kieren Beckett](https://kierenb.net)

Distributed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for more information.
