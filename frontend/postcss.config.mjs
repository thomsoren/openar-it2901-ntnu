import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import mixins from "postcss-mixins";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  plugins: [
    mixins({
      mixinsFiles: [
        resolve(
          __dirname,
          "node_modules/@ocean-industries-concept-lab/openbridge-webcomponents/src/mixins/fonts.css"
        ),
      ],
    }),
  ],
};
