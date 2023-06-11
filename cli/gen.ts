import axios from 'axios';
import fs from 'fs';
import { parse } from 'JSONStream';
import csv from 'csv-parser';
import { 
    getDb,
    createItemsTable,
    createRecipesTable,
    insertItem,    
    insertRecipe,
    getAllRecipesIngredients,
 } from './data.js';
 import { UniversalClient } from '../shared/index.js';

const ITEM_ID_MAPPING_LOCATION = 'https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/master/libs/data/src/lib/json/items.json';
const RECIPE_LOCATION = 'https://raw.githubusercontent.com/viion/ffxiv-datamining/master/csv/Recipe.csv';
const RETAINER_VENTURE_LOCATION = 'https://raw.githubusercontent.com/xivapi/ffxiv-datamining/e55e6d71d43999157db5a5cca94e7d596fd7088d/csv/RetainerTaskNormal.csv';

const ITEMS_RAW_JSON_FILE = 'items_raw.json';
const ITEMS_MASSAGED_JSON_FILE = 'items_massaged.json';
const RECIPES_RAW_CSV_FILE = 'recipes.csv';
const RETAINER_VENTURE_LOCATION_CSV_FILE = 'retainer_task_normal.csv';

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

async function maybeFetch() {
    if (refetch) {
        console.log('Refetching');
        await axios.get(ITEM_ID_MAPPING_LOCATION)
            .then((response) => {
                return fs.promises.writeFile(ITEMS_RAW_JSON_FILE, JSON.stringify(response.data), 'utf8');
            });
        await axios.get(RECIPE_LOCATION)
            .then((response) => {
                return fs.promises.writeFile(RECIPES_RAW_CSV_FILE, response.data, 'utf8');
            });
    } else {
        console.log('Not refetching');
    }
}

async function maybeRegenItems() {
    return new Promise<void>((resolve, reject) => {
        if (regenItems) {
            if (dropAll) {
                createItemsTable();
            }
            const rawReadStream = fs.createReadStream(ITEMS_RAW_JSON_FILE, 'utf8');
            const jsonParser = parse('*');
            rawReadStream.pipe(jsonParser);
            //TODO: unclear how JSONStream handles maps, otherwise this should not require a temp var
            let id = 0;
            jsonParser.on('data', (data) => {
                // some items have no name, they're useless I think but need to track the ID
                if (data.en || data.en === '') {
                    id++;
                }
                if (data.en) {
                    insertItem({ id, name: data.en });
                }
            });
            jsonParser.on('end', () => {
                console.log('Items done');
                resolve();
            });
        } else {
            console.log('Not regenerating items');
            resolve();
        }
    });
}

async function maybeRegenRecipes() {
    return new Promise<void>((resolve, reject) => {
        if (regenRecipes) {
            if (dropAll) {
                createRecipesTable();
            }
            const rawReadStream = fs.createReadStream(RECIPES_RAW_CSV_FILE, 'utf8');
            rawReadStream.pipe(csv({ skipLines: 1 }))
                .on('data', (data) => {
                    let ingredientAmountPairs = {};
                    for (let i = 0; i < 10; i++) {
                        const itemId = data[`Item{Ingredient}[${i}]`];
                        const itemAmount = data[`Amount{Ingredient}[${i}]`];
                        ingredientAmountPairs = { 
                            ...ingredientAmountPairs,
                            [itemId]: itemAmount,
                        }
                    }
                    if (Object.keys(ingredientAmountPairs).length === 0) {
                        return;
                    }
                    const recipeId = data['Number'];
                    const craftedItemId = data['Item{Result}'];
                    const craftedItemAmount = data['Amount{Result}'];
                    const recipeLevel = data['RecipeLevelTable'];
                    insertRecipe({ 
                        id: recipeId, craftedItemId, craftedItemAmount, recipeLevel
                     }, ingredientAmountPairs);
                })
                .on('end', () => {
                    console.log('Recipes done');
                    resolve();
                });
        } else {
            console.log('Not regenerating recipes');
            resolve();
        }
    });
}

async function maybeGetRecipePrices() {
    await getAllRecipesIngredients((error, rows) => {
        console.log(error);
        console.log(rows)
        rows.forEach(row => console.log(row));
    })
}

type VentureItem = {
    itemId: number;
    itemQuantityBreakpoints: number[];
}
const ventureItems: VentureItem[] = [];
async function maybeGenerateVentureCalcs() {
    if (!ventures) {
        console.log('Not generating ventures stats');
        return;
    }
    await axios.get(RETAINER_VENTURE_LOCATION)
        .then((response) => {
            return fs.promises.writeFile(RETAINER_VENTURE_LOCATION_CSV_FILE, response.data, 'utf8');
        });
    const marketable = await UniversalClient.marketable();
    await new Promise<void>((resolve, reject) => {
            const rawReadStream = fs.createReadStream(RETAINER_VENTURE_LOCATION_CSV_FILE, 'utf8');
            rawReadStream.pipe(csv({ skipLines: 1 }))
                .on('data', (data) => {
                    const itemId = Number(data[`Item`]);
                    if (marketable.includes(itemId)) {
                        const itemQuantityBreakpoints: number[] = [];
                        for (let i = 0; i < 5; i++) {
                            itemQuantityBreakpoints.push(data[`Quantity[${i}]`]);
                        }
                        ventureItems.push({
                            itemId,
                            itemQuantityBreakpoints,
                        })
                    }
                })
                .on('end', () => {
                    console.log('Retainer ventures done');
                    console.log(ventureItems.length);
                    resolve();
                });
    });        

    const itemStats = await UniversalClient.itemStats(ventureItems.map(({ itemId }) => itemId));
    await fs.promises.writeFile('temp.json', JSON.stringify(itemStats));
    return;
}

async function runGen() {
    const beforeMemory = process.memoryUsage().heapUsed;
    await maybeFetch();
    await maybeRegenItems();
    await maybeRegenRecipes();
    // await maybeGetRecipePrices();
    await maybeGenerateVentureCalcs();
    // UniversalClient.itemStats([34343,34344,34344]);

    const afterMemory = process.memoryUsage().heapUsed;

    console.log(`Finished, before memory: ${beforeMemory} after ${afterMemory}`);
}

runGen();