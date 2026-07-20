#!/usr/bin/env bash
# Generates a throwaway private CA and a leaf certificate signed by it, for
# TLS-trust verification. This is the synthetic stand-in for an enterprise
# appliance's private CA: cryptographically it plays the same role, so it
# exercises the same client trust decision without needing a real appliance.
#
# Usage: make-test-ca.sh <output-dir> [hostname]
#
# Produces, in <output-dir>: ca.crt ca.key leaf.crt leaf.key
#
# Portability: uses only the openssl subset shared by OpenSSL 3.x (CI/Debian)
# and LibreSSL 3.x (macOS). Notably it passes SAN via -extfile rather than
# -addext, and never inspects certs with -ext, neither of which LibreSSL has.
set -euo pipefail

OUT_DIR="${1:?usage: make-test-ca.sh <output-dir> [hostname]}"
HOSTNAME_="${2:-localhost}"
DAYS=1

mkdir -p "$OUT_DIR"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$OUT_DIR/ca.key" -out "$OUT_DIR/ca.crt" \
  -days "$DAYS" -subj "/CN=EH Test Private CA" 2>/dev/null

openssl req -newkey rsa:2048 -nodes \
  -keyout "$OUT_DIR/leaf.key" -out "$OUT_DIR/leaf.csr" \
  -subj "/CN=$HOSTNAME_" 2>/dev/null

printf 'subjectAltName=DNS:%s,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' \
  "$HOSTNAME_" > "$OUT_DIR/ext.cnf"

openssl x509 -req -in "$OUT_DIR/leaf.csr" \
  -CA "$OUT_DIR/ca.crt" -CAkey "$OUT_DIR/ca.key" -CAcreateserial \
  -out "$OUT_DIR/leaf.crt" -days "$DAYS" -extfile "$OUT_DIR/ext.cnf" 2>/dev/null

rm -f "$OUT_DIR/leaf.csr" "$OUT_DIR/ext.cnf" "$OUT_DIR/ca.srl"
