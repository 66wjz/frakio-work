#!/bin/sh
set -eu

REPOSITORY="${FRAKIO_WORK_REPOSITORY:-MadsGao/frakio-work}"
INSTALL_BASE="${FRAKIO_WORK_INSTALL_BASE:-$HOME/.local/share/frakio-work}"
BIN_DIR="${FRAKIO_WORK_BIN_DIR:-$HOME/.local/bin}"
API_PORT="${PORT:-8787}"

if [ "${1:-}" = "--rollback" ]; then
  [ -L "$INSTALL_BASE/current" ] && [ -L "$INSTALL_BASE/previous" ] || { echo "No previous Frakio Work Web version is available." >&2; exit 1; }
  CURRENT_TARGET="$(readlink "$INSTALL_BASE/current")"
  PREVIOUS_TARGET="$(readlink "$INSTALL_BASE/previous")"
  ln -sfn "$PREVIOUS_TARGET" "$INSTALL_BASE/current"
  ln -sfn "$CURRENT_TARGET" "$INSTALL_BASE/previous"
  if command -v systemctl >/dev/null 2>&1 && [ -f "$HOME/.config/systemd/user/frakio-work.service" ]; then
    systemctl --user daemon-reload
    systemctl --user restart frakio-work.service
  elif [ "$(uname -s)" = "Darwin" ]; then
    launchctl kickstart -k "gui/$(id -u)/com.frakio.work.web"
  else
    "$BIN_DIR/frakio-work" restart
  fi
  echo "Frakio Work Web rolled back to $(basename "$PREVIOUS_TARGET")."
  exit 0
fi

case "$(uname -s)" in
  Darwin) OS="mac" ;;
  Linux) OS="linux" ;;
  *) echo "Frakio Work supports macOS and Linux through install.sh." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64) ARCH="x64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
if [ "$OS" = "linux" ] && [ "$ARCH" != "x64" ]; then
  echo "The Linux self-hosted package currently supports x64 only." >&2
  exit 1
fi

if [ -n "${FRAKIO_WORK_VERSION:-}" ]; then
  TAG="$FRAKIO_WORK_VERSION"
else
  TAG="$(curl -fsSL "https://api.github.com/repos/$REPOSITORY/releases/latest" | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
fi
[ -n "$TAG" ] || { echo "Unable to resolve the latest Frakio Work release." >&2; exit 1; }
VERSION="${TAG#v}"
PLATFORM="$OS-$ARCH"
ASSET="Frakio.Work.Web-$VERSION-$PLATFORM.tar.gz"
CHECKSUM="Frakio.Work.Web-$VERSION-$PLATFORM.SHA256SUMS.txt"
BASE_URL="https://github.com/$REPOSITORY/releases/download/$TAG"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL --retry 3 -o "$TMP_DIR/$ASSET" "$BASE_URL/$ASSET"
curl -fsSL --retry 3 -o "$TMP_DIR/$CHECKSUM" "$BASE_URL/$CHECKSUM"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$TMP_DIR" && sha256sum -c "$CHECKSUM")
elif command -v shasum >/dev/null 2>&1; then
  (cd "$TMP_DIR" && shasum -a 256 -c "$CHECKSUM")
else
  echo "A SHA-256 checksum tool is required." >&2
  exit 1
fi

mkdir -p "$INSTALL_BASE/versions" "$BIN_DIR" "$HOME/.frakio-work/logs"
if [ -L "$INSTALL_BASE/current" ]; then
  if command -v systemctl >/dev/null 2>&1 && [ -f "$HOME/.config/systemd/user/frakio-work.service" ]; then
    systemctl --user stop frakio-work.service || true
  elif [ "$OS" = "mac" ]; then
    launchctl bootout "gui/$(id -u)/com.frakio.work.web" >/dev/null 2>&1 || true
  else
    OLD_NODE="$(find "$INSTALL_BASE/current/runtime/hermes" -path "*/$PLATFORM/node/bin/node" -type f | head -n 1)"
    [ -z "$OLD_NODE" ] || "$OLD_NODE" "$INSTALL_BASE/current/bin/frakio-work-service.mjs" stop || true
  fi
fi
TARGET="$INSTALL_BASE/versions/$VERSION"
rm -rf "$TARGET.new"
mkdir -p "$TARGET.new"
tar -xzf "$TMP_DIR/$ASSET" -C "$TARGET.new" --strip-components=1
if [ -e "$TARGET" ]; then rm -rf "$TARGET"; fi
mv "$TARGET.new" "$TARGET"

if [ -L "$INSTALL_BASE/current" ]; then
  PREVIOUS="$(readlink "$INSTALL_BASE/current")"
  ln -sfn "$PREVIOUS" "$INSTALL_BASE/previous"
fi
ln -sfn "$TARGET" "$INSTALL_BASE/current"
ln -sfn "$INSTALL_BASE/current/bin/frakio-work-service.mjs" "$BIN_DIR/frakio-work"
chmod +x "$TARGET/bin/frakio-work-service.mjs" "$BIN_DIR/frakio-work"

RUNTIME_NODE="$(find "$INSTALL_BASE/current/runtime/hermes" -path "*/$PLATFORM/node/bin/node" -type f | head -n 1)"
[ -x "$RUNTIME_NODE" ] || { echo "Bundled Node runtime is missing." >&2; exit 1; }

if [ "$OS" = "linux" ] && command -v systemctl >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/frakio-work.service" <<EOF
[Unit]
Description=Frakio Work managed Web service
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_BASE/current
Environment=FRAKIO_WORK_DEPLOYMENT_MODE=managed-web
Environment=FRAKIO_WORK_PACKAGED=1
Environment=FRAKIO_WORK_HOME=$HOME/.frakio-work
Environment=FRAKIO_WORK_APP_ROOT=$INSTALL_BASE/current
Environment=FRAKIO_WORK_WEB_DIST=$INSTALL_BASE/current/dist
Environment=FRAKIO_WORK_RUNTIME_HOME=$INSTALL_BASE/current/runtime
Environment=PORT=$API_PORT
ExecStart=$RUNTIME_NODE $INSTALL_BASE/current/apps/api/server.mjs
Restart=on-failure
RestartSec=2
StandardOutput=append:$HOME/.frakio-work/logs/managed-web.log
StandardError=append:$HOME/.frakio-work/logs/managed-web.log

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable frakio-work.service
  systemctl --user restart frakio-work.service
elif [ "$OS" = "mac" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.frakio.work.web.plist"
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.frakio.work.web</string>
<key>ProgramArguments</key><array><string>$RUNTIME_NODE</string><string>$INSTALL_BASE/current/apps/api/server.mjs</string></array>
<key>WorkingDirectory</key><string>$INSTALL_BASE/current</string>
<key>EnvironmentVariables</key><dict>
<key>FRAKIO_WORK_DEPLOYMENT_MODE</key><string>managed-web</string>
<key>FRAKIO_WORK_PACKAGED</key><string>1</string>
<key>FRAKIO_WORK_HOME</key><string>$HOME/.frakio-work</string>
<key>FRAKIO_WORK_APP_ROOT</key><string>$INSTALL_BASE/current</string>
<key>FRAKIO_WORK_WEB_DIST</key><string>$INSTALL_BASE/current/dist</string>
<key>FRAKIO_WORK_RUNTIME_HOME</key><string>$INSTALL_BASE/current/runtime</string>
<key>PORT</key><string>$API_PORT</string>
</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$HOME/.frakio-work/logs/managed-web.log</string>
<key>StandardErrorPath</key><string>$HOME/.frakio-work/logs/managed-web.log</string>
</dict></plist>
EOF
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
else
  "$BIN_DIR/frakio-work" start
fi

echo "Frakio Work $VERSION installed."
echo "Local URL: http://127.0.0.1:$API_PORT"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  PASSWORD="$(sed -n 's/.*administrator password: //p' "$HOME/.frakio-work/logs/managed-web.log" 2>/dev/null | tail -n 1)"
  [ -n "$PASSWORD" ] && { echo "Administrator password: $PASSWORD"; break; }
  sleep 1
done
echo "Command: $BIN_DIR/frakio-work"
