# Third-party notices

Torrent404 contains and adapts software from the open-source projects listed below.
These projects are not affiliated with Torrent404 and do not endorse it.

## TorLink (principal upstream project)

TorLink is the principal upstream reference and a source of code used and modified
by Torrent404.

- Project: <https://github.com/baairon/torlink>
- Author: baairon / bairon.dev
- Reviewed revision: `205cabb00c348c2272e1761fbf4b46b682c0c275`
- License: MIT
- Copyright: `Copyright (c) 2026 bairon.dev`

Torrent404 uses and modifies portions of TorLink's MIT-licensed code, including
selected provider response mapping and torrent/network behavior. The adapted code
is integrated behind Torrent404's own provider, Core, and engine adapter boundaries.
Torrent404 is an independently maintained downstream project, not an official
TorLink release. No affiliation, collaboration, or upstream endorsement is implied.

The following original notice and full license text apply:

```text
MIT License

Copyright (c) 2026 bairon.dev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## WebTorrent

Torrent404 bundles `webtorrent@3.0.21` as its Torrent engine and carries a minimally
patched `bittorrent-tracker` dependency for bundled Node runtime compatibility.
Both are provided under the MIT License; the local patch does not change their
ownership or license.

- Project: <https://github.com/webtorrent/webtorrent>
- Patched dependency source: `packages/bittorrent-tracker`
- License: MIT
- Copyright: `Copyright (c) Feross Aboukhadijeh and WebTorrent, LLC`

```text
The MIT License (MIT)

Copyright (c) Feross Aboukhadijeh and WebTorrent, LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
