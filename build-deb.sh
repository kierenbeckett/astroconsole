#!/usr/bin/env bash
set -euo pipefail

APP_NAME="astroconsole"
VERSION="0.1"
ARCH="all"
MAINTAINER="Kieren Beckett <mail@kierenb.net>"
DESCRIPTION="AstroConsole, Telescope Control Webapp"
DEPENDENCIES="python3, systemd"

# Paths
BUILD_DIR="$(pwd)/build"
PKG_DIR="$BUILD_DIR/${APP_NAME}_${VERSION}"
DEBIAN_DIR="$PKG_DIR/DEBIAN"
INSTALL_DIR="$PKG_DIR/usr/lib/$APP_NAME"
BIN_DIR="$PKG_DIR/usr/bin"
SYSTEMD_DIR="$PKG_DIR/lib/systemd/system"
CONFIG_DIR="$PKG_DIR/etc/$APP_NAME"

# Clean up from previous runs
rm -rf "$BUILD_DIR"
mkdir -p "$DEBIAN_DIR" "$INSTALL_DIR" "$BIN_DIR" "$SYSTEMD_DIR" "$CONFIG_DIR"

### Control file
cat > "$DEBIAN_DIR/control" <<EOF
Package: $APP_NAME
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Maintainer: $MAINTAINER
Depends: $DEPENDENCIES
Description: $DESCRIPTION
EOF

### Maintainer scripts

# postinst: create system user, set ownership, start service
cat > "$DEBIAN_DIR/postinst" <<EOF
#!/bin/sh
set -e

# Create system user if not exists
if ! id -u $APP_NAME >/dev/null 2>&1; then
    adduser --system --group --home /var/lib/$APP_NAME --no-create-home \
        --disabled-login --disabled-password $APP_NAME
fi

# Ensure app directories are owned by this user
chown -R $APP_NAME:$APP_NAME /usr/lib/$APP_NAME
chown -R $APP_NAME:$APP_NAME /etc/$APP_NAME
mkdir -p /var/lib/$APP_NAME
chown -R $APP_NAME:$APP_NAME /var/lib/$APP_NAME

systemctl daemon-reload
systemctl enable $APP_NAME.service
systemctl start $APP_NAME.service

exit 0
EOF
chmod 755 "$DEBIAN_DIR/postinst"

# prerm: stop/disable service before removal
cat > "$DEBIAN_DIR/prerm" <<EOF
#!/bin/sh
set -e
systemctl stop $APP_NAME.service || true
systemctl disable $APP_NAME.service || true
exit 0
EOF
chmod 755 "$DEBIAN_DIR/prerm"

# postrm: cleanup user/group and config on purge
cat > "$DEBIAN_DIR/postrm" <<EOF
#!/bin/sh
set -e
if [ "\$1" = "purge" ]; then
    deluser --system $APP_NAME || true
    rm -rf /var/lib/$APP_NAME
    rm -rf /etc/$APP_NAME
fi
exit 0
EOF
chmod 755 "$DEBIAN_DIR/postrm"

### Mark config file as a conffile
echo "/etc/$APP_NAME/$APP_NAME.json" > "$DEBIAN_DIR/conffiles"

### Copy your Python app code
cp astroconsole.py "$INSTALL_DIR/"

### Vendor Python dependency
pip install -r requirements.txt --target "$INSTALL_DIR/vendor"

### Copy static files
cp -r www "$INSTALL_DIR/"

### Config file
cat > "$CONFIG_DIR/$APP_NAME.json" <<EOF
{
  "devices": {}
}
EOF

### Systemd service unit
cat > "$SYSTEMD_DIR/$APP_NAME.service" <<EOF
[Unit]
Description=AstroConsole
After=multi-user.target

[Service]
Type=idle
User=$APP_NAME
Group=$APP_NAME
WorkingDirectory=/usr/lib/$APP_NAME
ExecStart=/usr/bin/$APP_NAME
Restart=always
RestartSec=60

[Install]
WantedBy=multi-user.target
EOF

### Executable wrapper
cat > "$BIN_DIR/$APP_NAME" <<EOF
#!/usr/bin/env bash
export PYTHONPATH="/usr/lib/$APP_NAME/vendor:\$PYTHONPATH"
exec python3 /usr/lib/$APP_NAME/astroconsole.py "\$@"
EOF
chmod 755 "$BIN_DIR/$APP_NAME"

### Build .deb
dpkg-deb --build "$PKG_DIR" "$BUILD_DIR"

echo "✅ Package built: $BUILD_DIR/${APP_NAME}_${VERSION}_${ARCH}.deb"