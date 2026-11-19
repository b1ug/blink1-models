# blink(1) Models

The [model viewer](https://b1ug.github.io/blink1-models/) shows the blink(1) mk2 used by nb1 Debugger, nb1 WebHID and nb1 Guide. This repository maintains the reusable geometry, assembly code, provenance and per-file checksums. Each consumer can import its own pinned version and ship it offline.

## Use the mk2 model

Download a [model release](https://github.com/b1ug/blink1-models/releases), or add its full Git commit tarball to your frontend dependencies. The root package contains the assets and assembly modules and has no runtime dependencies. Supply Three.js and STLLoader in your application. The model viewer uses Three.js 0.187.0.

The seven files listed in [models/mk2/manifest.json](models/mk2/manifest.json) make up the model. When importing, verify the digest of the manifest from the pinned revision, then each file's byte length and SHA-256. Preserve relative paths, source notices and licenses. The release ZIP includes the same paths relative to its root. Run `python3 scripts/check.py` to verify a checkout.

```js
import { createBlink1Model } from './models/mk2/light-model.js';

const root = new URL('./models/mk2/model-assets/', import.meta.url);
const [diffuserGeometry, frameGeometry] = await Promise.all(
  ['diffuser', 'frame'].map(part => loader.loadAsync(
    new URL('blink1mk2_enclosure_' + part + '_v3k.stl', root).href
  ))
);
const model = createBlink1Model(THREE, { diffuserGeometry, frameGeometry });
diffuserGeometry.dispose();
frameGeometry.dispose();
scene.add(model.group);
model.setColors('#dd4444', '#4488dd', 'preview');
```

Remove the group and call `model.dispose()` when finished. The first LED faces the blink(1) wordmark, the second faces ThingM. The emitted colors illustrate the requested RGB values on screen.

A Node build can also import `stageModel` from `@b1ug/blink1-models/stage` and call `stageModel(destination, manifestSha256)`. Use a consumer-owned staging directory and the expected digest from your dependency lock. The helper verifies the manifest and all seven files before copying them.

## Model and licensing

The two enclosure STLs reproduce the [ThingM v3k files](https://github.com/todbot/blink1/tree/101abe3599c661c4dd4d1204b4d50fb592293143/hardware/enclosure). Their dimensions use undeclared STL units. The display assembly fits the frame and adds the USB connector and materials. These serve visualization, with no mechanical tolerances or calibrated optics supplied.

ThingM's geometry and CAD derivatives carry [CC BY-SA 4.0](models/mk2/model-assets/LICENSE.txt). The [source record](models/mk2/model-assets/source.json) documents the original files and changes. The assembly modules were extracted from the [nb1 debugger](https://github.com/b1ug/nb1-debugger/tree/90225555dad6ac2a17eac8d46a2469d00a04256e/src/nightlab). Software is supplied under the [MIT license](LICENSE), subject to the geometry attribution above. blink(1) is a ThingM trademark.

## Build the catalog

```sh
npm ci --prefix site --ignore-scripts
python3 scripts/check.py --site --bundle
python3 -m http.server --directory dist/site 8000
```

Open `http://localhost:8000/`. The generated viewer and model files are self-contained. GitHub Actions checks file integrity and builds both the catalog and versioned model archive.
