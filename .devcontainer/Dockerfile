FROM mcr.microsoft.com/devcontainers/base:ubuntu

RUN export DEBIAN_FRONTEND=noninteractive \
    && apt-get update \
    && apt-get -y install software-properties-common \
    && apt-add-repository ppa:mutlaqja/ppa \
    && apt-get update \
    && apt-get -y install indi-full python3-pip

ADD requirements.txt /
RUN pip install -r /requirements.txt --break-system-packages

ADD astroconsole.json /etc/astroconsole/astroconsole.json
ADD astroconsole /usr/local/bin/
RUN chmod 755 /usr/local/bin/astroconsole
