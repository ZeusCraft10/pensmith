# SEC-01 test TLS material (test-only)

These files let `tests/helpers/local-servers/transport.ts` run a local HTTPS
server that answers for the hostname `sni.pensmith.test`, so
`tests/ssrf-pinning.test.ts` can prove that `bin/lib/http.ts` dials the
validated IP while keeping the hostname for TLS SNI and certificate checks.

| File | What |
|---|---|
| `ca.crt` | Self-signed test CA (the trust anchor the test passes through the http.ts test seam). Its private key was discarded after signing. |
| `server.crt` | Leaf certificate for `DNS:sni.pensmith.test`, signed by the test CA. |
| `server.key` | The leaf's private key. **Test-only**: it protects nothing and is trusted by nothing outside the test run. |

The http.ts test seam that trusts `ca.crt` works only under a test context and
only for the hostnames the test registers (`__setHttpTestSeams`), so this CA can
never be trusted by a real run.

Regenerate (100-year validity) with:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 36500 \
  -subj "/CN=pensmith SEC-01 test CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=sni.pensmith.test"
printf 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:sni.pensmith.test\n' > ext.cnf
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 36500 -sha256 -extfile ext.cnf
rm ca.key ca.srl server.csr ext.cnf
```
