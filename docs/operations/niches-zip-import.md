# Importing a ZIP content pack in Niches

Niches accepts a small content ZIP in the **Create** or **Content** tab. Use **Import ZIP as drafts**. The archive is unpacked in the browser; only accepted media files are uploaded to private Niches storage. Each media file becomes a draft in the current niche. No content is automatically posted to social platforms.

## Supported formats

Include up to 20 MP4, MOV, WebM, JPG, PNG or WebP files, each no larger than 25 MiB. The total uncompressed media must stay within 120 MiB and the ZIP itself within 160 MiB. These restrictions protect the mobile browser and remain subject to the separate Niches account/storage quota. Large archives should be split into multiple ZIP files.

Include one optional **metadata.json**, **manifest.json** or **captions.json**:

```json
{
  "posts": [
    {
      "filename": "adhd-sketch-01.mp4",
      "title": "The Wrong Tab: Episode 1",
      "description": "That moment your brain opens 37 tabs.",
      "hashtags": ["#ADHDHumour", "#Cartoon", "#Comedy"]
    }
  ]
}
```

A CSV named **metadata.csv** or **captions.csv** also works:

```csv
filename,title,caption,hashtags
adhd-sketch-01.mp4,The Wrong Tab: Episode 1,That moment your brain opens 37 tabs.,#ADHDHumour #Comedy
```

Without a metadata manifest, a text file with the matching base name (such as `adhd-sketch-01.txt`) supplies a caption. The title defaults to the media filename. Metadata is matched by filename, not ZIP ordering. Duplicate basenames, encrypted archives, archive traversal and unsupported ZIP formats are rejected.

## Publishing boundaries

All imported items remain **private drafts**. Niches proposes the current niche's accounts, but they are not automatically authorised. A real provider connection and owner review are required before using the scheduled publishing workflow. A schedule only becomes a provider publishing job when approved through the direct publisher, not simply by importing a ZIP.

A partial upload failure leaves successfully imported drafts and some media files in the private library; inspect the visible error, review existing drafts and delete any unused media before retrying.

## Verification

`npm run test:web` tests metadata matching, supported compressed sidecar files and unsafe archive rejection. `npm run test:browser` also exercises an actual browser-side ZIP upload and saved draft in the disposable local Niches environment. Production deployment additionally checks the private media API, session, account isolation and separate KV backend. No provider connection or real social post is marked verified merely because ZIP importing succeeds.
