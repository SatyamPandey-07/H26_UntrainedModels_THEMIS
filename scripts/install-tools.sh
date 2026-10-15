#!/usr/bin/env bash
# Installs the pinned analysis tools Themis uses (Opengrep, OSV-Scanner, Trivy, and for Python repositories
# pip-audit and uv) into a user bin directory.
# Linux x86_64 only. Checksums are verified where the project publishes them.
#
# Usage: scripts/install-tools.sh [install-dir]   (default: ~/.local/bin)
set -euo pipefail

OPENGREP_VERSION="v1.30.2"
OSV_SCANNER_VERSION="v2.7.0"
TRIVY_VERSION="0.76.0"
PIP_AUDIT_VERSION="2.10.1"
UV_VERSION="0.11.26"

BIN_DIR="${1:-$HOME/.local/bin}"
mkdir -p "$BIN_DIR"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [[ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]]; then
  echo "install-tools.sh supports Linux x86_64 only; install opengrep, osv-scanner and trivy manually." >&2
  exit 1
fi

fetch() {
  curl -fsSL --retry 4 --retry-delay 3 --connect-timeout 20 -o "$2" "$1"
}

echo "Installing Opengrep ${OPENGREP_VERSION}"
fetch "https://github.com/opengrep/opengrep/releases/download/${OPENGREP_VERSION}/opengrep_manylinux_x86" "$WORK/opengrep"
install -m 0755 "$WORK/opengrep" "$BIN_DIR/opengrep"

echo "Installing OSV-Scanner ${OSV_SCANNER_VERSION}"
fetch "https://github.com/google/osv-scanner/releases/download/${OSV_SCANNER_VERSION}/osv-scanner_linux_amd64" "$WORK/osv-scanner_linux_amd64"
fetch "https://github.com/google/osv-scanner/releases/download/${OSV_SCANNER_VERSION}/osv-scanner_SHA256SUMS" "$WORK/osv.sums"
(cd "$WORK" && grep " osv-scanner_linux_amd64$" osv.sums | sha256sum -c -)
install -m 0755 "$WORK/osv-scanner_linux_amd64" "$BIN_DIR/osv-scanner"

echo "Installing Trivy ${TRIVY_VERSION}"
TRIVY_TGZ="trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz"
fetch "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/${TRIVY_TGZ}" "$WORK/${TRIVY_TGZ}"
fetch "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_checksums.txt" "$WORK/trivy.sums"
(cd "$WORK" && grep " ${TRIVY_TGZ}$" trivy.sums | sha256sum -c -)
tar -xzf "$WORK/${TRIVY_TGZ}" -C "$WORK" trivy
install -m 0755 "$WORK/trivy" "$BIN_DIR/trivy"

# Python tools live in their own virtualenv (system Python is externally managed) and are linked into BIN_DIR.
# A failure here is not fatal: pip-audit and uv are only needed for Python repositories, and a missing tool is
# reported as UNVERIFIED by the pipeline.
echo "Installing pip-audit ${PIP_AUDIT_VERSION} and uv ${UV_VERSION}"
PYTOOLS="$(dirname "$BIN_DIR")/themis-pytools"
if python3 -m venv "$PYTOOLS" \
  && "$PYTOOLS/bin/python" -m pip install --quiet --disable-pip-version-check \
    "pip-audit==${PIP_AUDIT_VERSION}" "uv==${UV_VERSION}"; then
  ln -sf "$PYTOOLS/bin/pip-audit" "$BIN_DIR/pip-audit"
  ln -sf "$PYTOOLS/bin/uv" "$BIN_DIR/uv"
else
  echo "warning: could not install pip-audit/uv; Python repositories will report these scanners as UNVERIFIED." >&2
fi

echo
for tool in opengrep osv-scanner trivy pip-audit uv; do
  [[ -x "$BIN_DIR/$tool" ]] || continue
  printf '%-12s %s\n' "$tool" "$("$BIN_DIR/$tool" --version 2>&1 | head -1)"
done
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Add $BIN_DIR to PATH to use these tools." ;;
esac
