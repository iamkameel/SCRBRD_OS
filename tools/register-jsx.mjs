/** Installs the .jsx transform hook. Used as `node --import ./tools/register-jsx.mjs`. */
import { register } from "node:module";
register("./jsx-loader.mjs", import.meta.url);
