import fs from 'fs';
import { generateCsvs } from './csv-report-gen.js';
import { maybeFetch, maybeRegenItems, maybeRegenRecipes } from './sqlite-gen.js';


let refetch = false;
let regenItems = false;
let regenRecipes = false;
let dropAll = false;
let ventures = false;
process.argv.forEach((argName) => {
    if (argName === 'fetch') {
        refetch = true;
    }

    if (argName === 'items') {
        regenItems = true;
    }

    if (argName === 'recipes') {
        regenRecipes = true;
    }
    
    if (argName === 'drop') {
        dropAll = true;
    }

    if (argName === 'ventures') {
        ventures = true;
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

    // await maybeFetch();
    // await maybeRegenItems();
    // await maybeRegenRecipes();
    // await maybeGetRecipePrices();
    if (ventures) {
        await generateCsvs();
    }

    const afterMemory = process.memoryUsage().heapUsed;

    console.log(`Finished, before memory: ${beforeMemory} after ${afterMemory}`);
}

runCli();