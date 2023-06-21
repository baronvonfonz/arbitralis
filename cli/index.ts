import fs from 'fs';
import { generateCsvs } from './csv-report-gen.js';
import { regenAll } from './sqlite-gen.js';


let dataGen = false;
let dropAll = false;
let csvGen = false;
process.argv.forEach((argName) => {
    if (argName === 'data-gen') {
        dataGen = true;
    }
    
    if (argName === 'drop') {
        dropAll = true;
    }

    if (argName === 'csv-gen') {
        csvGen = true;
    }
});

async function runCli() {
    const beforeMemory = process.memoryUsage().heapUsed;

    const distDirectoryPath = './dist/gh-pages/csv';
    if (!fs.existsSync(distDirectoryPath)) {
        fs.mkdirSync(distDirectoryPath, { recursive: true });
        console.log(`Directory structure created at ${distDirectoryPath}`);
    } else {
        console.log(`Directory structure already exists at ${distDirectoryPath}`);
    }

    if (dataGen) {
        await regenAll(dropAll);
    }

    if (csvGen) {
        await generateCsvs();
    }

    const afterMemory = process.memoryUsage().heapUsed;

    console.log(`Finished, before memory: ${beforeMemory} after ${afterMemory}`);
}

runCli();