# blink(1) Models

The [model viewer](https://b1ug.github.io/blink1-models/) shows the blink(1) mk2 used by nb1 Debugger, nb1 WebHID and nb1 Guide. This repository maintains the reusable geometry, assembly code, provenance and per-file checksums. Each consumer can import its own pinned version and ship it offline.

## Use the mk2 model

Download a [model release](https://github.com/b1ug/blink1-models/releases), or add its full Git commit tarball to your frontend dependencies. The root package contains the assets and assembly modules and has no runtime dependencies. Supply Three.js and STLLoader in your application. The model viewer uses Three.js 0.187.0.

The ten files listed in [models/mk2/manifest.json](models/mk2/manifest.json) make up the model. When importing, verify the digest of the manifest from the pinned revision, then each file's byte length and SHA-256. Preserve relative paths, source notices and licenses. The release ZIP includes the same paths relative to its root. Run `python3 scripts/check.py` to verify a checkout.

```js
import { createBlink1Model } from './models/mk2/light-model.js';

const root = new URL('./models/mk2/model-assets/', import.meta.url);
const [diffuserGeometry, frameGeometry] = await Promise.all(
  ['diffuser', 'frame'].map(part => loader.loadAsync(
    new URL('blink1mk2_enclosure_' + part + '_v3k.stl', root).href
  ))
);
const model = createBlink1Model(THREE, { diffuserGeometry, frameGeometry, variant: 'assembled' });
diffuserGeometry.dispose();
frameGeometry.dispose();
scene.add(model.group);
model.setColors('#dd4444', '#4488dd', 'preview');
```

`variant` can be `shell`, `internals`, or `assembled`; omitting it preserves the existing shell view. The `internals` variant retains the USB plug and shows the PCB without the enclosure. The preview page offers `Empty shell` and `PCB only`; `assembled` remains available through this API. Remove the group and call `model.dispose()` when finished. The first LED faces the blink(1) wordmark, the second faces ThingM. The emitted colors illustrate the requested RGB values on screen.

A Node build can also import `stageModel` from `@b1ug/blink1-models/stage` and call `stageModel(destination, manifestSha256)`. Use a consumer-owned staging directory and the expected digest from your dependency lock. The helper verifies the manifest and all ten files before copying them.

## Model and licensing

The two STL files contain ThingM’s original v3k enclosure geometry. In the assembled model, the diffuser follows the two straight metal rails behind the USB plug. Their upper and lower edges are parallel up to the rounded tips, as seen in the mk2 side photo. The renderer adjusts the diffuser along its length while retaining its curved cross-section, engraved faces and rounded tail. The STL dimensions are in undeclared model units. [ThingM enclosure CAD](https://github.com/todbot/blink1/tree/101abe3599c661c4dd4d1204b4d50fb592293143/hardware/enclosure) · [ThingM side photo](https://github.com/todbot/blink1/blob/101abe3599c661c4dd4d1204b4d50fb592293143/docs/imgs/blink1mk2-twocolor-long.jpg)

The USB plug has four staggered contacts and retention holes on both broad faces. Its front edge and solder tails are positioned relative to the X1 footprint. The PCB outline, nominal board thickness, pad locations and LED windows follow the mk2 v2c6 EAGLE board. Component heights and light scattering are visual estimates. [ThingM PCB layout](https://github.com/todbot/blink1/blob/101abe3599c661c4dd4d1204b4d50fb592293143/hardware/schematic/blink1mk2_v2c6.brd) · [USB-IF Type-A interface drawing, page 4](https://www.usb.org/sites/default/files/CCWG_A_Plug_Form_Factor_Guideline_Revision_1.0_.pdf#page=4)

The renderings show the rail profile and shoulder finish before and after the correction, and both faces of the assembled PCB. The enclosure render uses the enclosure's CC BY-SA 4.0 license, and the board render uses the PCB's CC BY-SA 3.0 license. [Enclosure comparison](docs/images/mk2-enclosure-comparison.webp) · [PCB top and bottom](docs/images/mk2-pcb-assembly.webp)

The enclosure geometry and derivatives carry [CC BY-SA 4.0](models/mk2/model-assets/LICENSE.txt). The upstream blink(1) README declares [CC BY-SA 3.0](https://github.com/todbot/blink1/blob/main/README.md) for the PCB source; the derived layout is documented in [PCB-LICENSE.txt](models/mk2/model-assets/PCB-LICENSE.txt). The [source record](models/mk2/model-assets/source.json) documents each source and modification. Assembly code is supplied under the [MIT license](LICENSE). blink(1) is a ThingM trademark.

## Build the catalog

```sh
npm ci --prefix site --ignore-scripts
python3 scripts/check.py --site --bundle
python3 -m http.server --directory dist/site 8000
```

Open `http://localhost:8000/`. The generated viewer and model files are self-contained. GitHub Actions checks file integrity and builds both the catalog and versioned model archive.
