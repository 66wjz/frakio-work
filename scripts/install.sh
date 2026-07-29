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
  else
    "$BIN_DIR/frakio-work" restart
  fi
  echo "Frakio Work Web rolled back to $(basename "$PREVIOUS_TARGET")."
  exit 0
fi

case "$(uname -s)" in
  Linux) OS="linux" ;;
  *) echo "The self-hosted Frakio Work package supports Linux x64 through install.sh. macOS users should download the desktop DMG." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64) ARCH="x64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
if [ "$ARCH" != "x64" ]; then
  echo "The Linux self-hosted package currently supports x64 only." >&2
  exit 1
fi

if [ -n "${FRAKIO_WORK_VERSION:-}" ]; then
  TAG="${FRAKIO_WORK_VERSION#v}"
  TAG="v$TAG"
  RELEASE_API="https://api.github.com/repos/$REPOSITORY/releases/tags/$TAG"
else
  RELEASE_API="https://api.github.com/repos/$REPOSITORY/releases/latest"
fi
RELEASE_JSON="$(curl -fsSL "$RELEASE_API")"
[ -n "${TAG:-}" ] || TAG="$(printf '%s\n' "$RELEASE_JSON" | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
[ -n "$TAG" ] || { echo "Unable to resolve the latest Frakio Work release." >&2; exit 1; }
VERSION="${TAG#v}"
PLATFORM="$OS-$ARCH"
ASSET="Frakio.Work.Web-$VERSION-$PLATFORM.tar.gz"
BASE_URL="https://github.com/$REPOSITORY/releases/download/$TAG"
EXPECTED_HASH="$(printf '%s\n' "$RELEASE_JSON" | awk -v asset="$ASSET" '
  $0 ~ "\\\"name\\\": \\\"" asset "\\\"" { found = 1; next }
  found && /\"digest\": \"sha256:/ { sub(/^.*sha256:/, ""); sub(/\".*$/, ""); print; exit }
')"
[ -n "$EXPECTED_HASH" ] || { echo "Release metadata does not contain a SHA-256 digest for $ASSET." >&2; exit 1; }
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL --retry 3 -o "$TMP_DIR/$ASSET" "$BASE_URL/$ASSET"
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_HASH="$(sha256sum "$TMP_DIR/$ASSET" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL_HASH="$(shasum -a 256 "$TMP_DIR/$ASSET" | awk '{print $1}')"
else
  echo "A SHA-256 checksum tool is required." >&2
  exit 1
fi
[ "$ACTUAL_HASH" = "$EXPECTED_HASH" ] || { echo "Frakio Work package checksum mismatch." >&2; exit 1; }

mkdir -p "$INSTALL_BASE/versions" "$BIN_DIR" "$HOME/.frakio-work/logs"
if [ -L "$INSTALL_BASE/current" ]; then
  if command -v systemctl >/dev/null 2>&1 && [ -f "$HOME/.config/systemd/user/frakio-work.service" ]; then
    systemctl --user stop frakio-work.service || true
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

if command -v systemctl >/dev/null 2>&1; then
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
