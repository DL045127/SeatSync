// Child-process helper for the master-key race test: initialize the fixture
// secret under the directory in argv[2] and print one JSON line.
import { loadMaster } from "../../../src/locations/master-key.ts";

const rootDir = process.argv[2];
const { master, created } = await loadMaster({ mode: "fixture", target: "test", rootDir });
console.log(JSON.stringify({ created, key: master.toString("base64url") }));
