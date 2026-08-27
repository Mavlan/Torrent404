# TorLink security patch

This package is a minimal fork of `bittorrent-tracker@11.2.3` (MIT).

The only runtime source change removes the unpatched `ip@2.0.1` dependency
(`GHSA-2p57-rm9w-gvfp`, `CVE-2024-29415`) and replaces its sole upstream use,
decoding the optional 32-bit IPv4 field of an incoming UDP tracker announce,
with a local four-octet conversion. Upstream authorship and license files are
preserved.

Compatibility is covered by the legal local UDP-tracker/TCP-transfer smoke
test documented in `docs/DEPENDENCY_SECURITY.md`.
