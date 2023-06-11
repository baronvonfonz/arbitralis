import axios from 'axios';
import fs from 'fs';
import { parse } from 'JSONStream';
import csv from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import { 
    getDb,
    createItemsTable,
    createRecipesTable,
    insertItem,    
    insertRecipe,
    getAllRecipesIngredients,
    getItemsById,
 } from './data.js';
 import { UniversalClient } from '../shared/index.js';
import { UniversalisV2 } from 'universalis-ts';

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
    amountOne: number;
    amountTwo: number;
    amountThree: number;
    amountFour: number;
    amountFive: number;
}
type UniversalisEnrichedVentureItem = {
    name: string;
    regularSaleVelocity: number;
    averagePricePerUnit: number;
    amountOneTotalPrice: number;
    universalisUrl: string;
    minPricePerUnit: number;
    maxPricePerUnit: number;
} & VentureItem;
type UniversalisBuyEntry = {
    itemId: number;
    name: string;
    pricePerUnit: number;
    quantity: number;
    buyerName: string;
    timestamp: string;
    universalisUrl: string;
}
const ventureItems: VentureItem[] = [];
const universalisEnrichedVentureItems: UniversalisEnrichedVentureItem[] = [];
const universalisMaxBuyEntries: UniversalisBuyEntry[] = [];
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
                            amountOne: itemQuantityBreakpoints[0],
                            amountTwo: itemQuantityBreakpoints[1],
                            amountThree: itemQuantityBreakpoints[2],
                            amountFour: itemQuantityBreakpoints[3],
                            amountFive: itemQuantityBreakpoints[4],
                        })
                    }
                })
                .on('end', () => {
                    resolve();
                });
    });        

    // need to batch items 100 at once
    const itemIdSublists: number[][] = [];
    for (let i = 0; i < ventureItems.length; i += 100) {
        itemIdSublists.push(ventureItems.slice(i, i + 100).map(({ itemId }) => itemId));
    }
    const itemStats = (await Promise.all(
        itemIdSublists.map(async (itemIds) => UniversalClient.itemStats(itemIds))
    )).reduce((bigMap, subMap) => ({ ...bigMap, ...subMap }), {});

    // Useful for debugging
    // await fs.promises.writeFile('temp.json', JSON.stringify(itemStats, null, 2));
    if (!itemStats) {
        throw Error('Could not make map of item stats');
    }

    const itemIdToNameMap: Record<number,string> = (await getItemsById(itemIdSublists.flat()))
        .reduce((idNameMap, item) => ({ [item.id]: item.name, ...idNameMap }), {});

    ventureItems.forEach((ventureItem) => {
        const ventureItemStat = itemStats[ventureItem.itemId];
        if (!ventureItemStat) {
            console.log(`No data from universalis for ${ventureItem.itemId}`);
            return;
        }
        const numberOfBuys = ventureItemStat?.entries?.length;
        if ((numberOfBuys || 0) === 0) {
            console.log(`No buys for ${itemIdToNameMap[ventureItem.itemId]} (id:${ventureItem.itemId})`);
            return;
        }
        
        let minPricePerUnit = Number.MAX_SAFE_INTEGER;
        let maxPricePerUnit = 0;
        let maxPriceEntry: UniversalisV2.components["schemas"]["MinimizedSaleView"] = {};
        const sumOfPricePerUnit = ventureItemStat?.entries?.reduce((sum, saleEntry) => {
            const pricePerUnit = saleEntry.pricePerUnit || 0;
            const localMaxPricePerUnit = Math.max(maxPricePerUnit, pricePerUnit);
            if (localMaxPricePerUnit > maxPricePerUnit) {
                maxPricePerUnit = localMaxPricePerUnit;
                maxPriceEntry = saleEntry;
            }
            minPricePerUnit = Math.min(minPricePerUnit, pricePerUnit);
            return sum + pricePerUnit
        }, 0);
        const averagePricePerUnit = Math.floor((sumOfPricePerUnit || 0) / (numberOfBuys || 0));
        if (isNaN(averagePricePerUnit) || !maxPriceEntry.buyerName) {
            console.log(`NaN calc for ${ventureItem.itemId}`);
            return;
        }
        const regularSaleVelocity = ventureItemStat.regularSaleVelocity || 0;
        universalisEnrichedVentureItems.push({
            ...ventureItem,
            regularSaleVelocity,
            averagePricePerUnit,
            amountOneTotalPrice: averagePricePerUnit * ventureItem.amountOne,
            universalisUrl: `https://universalis.app/market/${ventureItem.itemId}`,
            maxPricePerUnit,
            minPricePerUnit,
            name: itemIdToNameMap[ventureItem.itemId]
        });
        universalisMaxBuyEntries.push({
            itemId: ventureItem.itemId,
            name: itemIdToNameMap[ventureItem.itemId],
            buyerName: maxPriceEntry.buyerName || 'N/A',
            pricePerUnit: maxPriceEntry.pricePerUnit || 0,
            quantity: maxPriceEntry.quantity || 0,
            timestamp: maxPriceEntry.timestamp ? new Date(maxPriceEntry.timestamp * 1000).toISOString() : 'N/A',
            universalisUrl: `https://universalis.app/market/${ventureItem.itemId}`,
        })
    });
    const csvWriter = createObjectCsvWriter({
        path: 'dist/gh-pages/csv/venture_items_stats.csv',
        header: [
            { id: 'name', title: 'Item Name' },
            { id: 'itemId', title: 'Item ID' },
            { id: 'universalisUrl', title: 'Universalis URL' },
            { id: 'amountOne', title: 'Amount One' },
            { id: 'amountTwo', title: 'Amount Two' },
            { id: 'amountThree', title: 'Amount Three' },
            { id: 'amountFour', title: 'Amount Four' },
            { id: 'amountFive', title: 'Amount Five' },
            { id: 'regularSaleVelocity', title: 'Daily Average Sold (Seven Day Window)' },
            { id: 'minPricePerUnit', title: 'Min Price Per Unit' },
            { id: 'averagePricePerUnit', title: 'Average Price Per Unit' },
            { id: 'maxPricePerUnit', title: 'Max Price Per Unit' },
            { id: 'amountOneTotalPrice', title: 'Total Per Venture (min amount)' },
        ]
    });
    await csvWriter.writeRecords(universalisEnrichedVentureItems)
        .then(() => {
            console.log('Wrote CSV!')
        })
        .catch((err) => {
            console.error(`CSV writing error: `, err);
        });
    const maxBuyerCsvWriter = createObjectCsvWriter({
        path: 'dist/gh-pages/csv/max_buyer_items_stats.csv',
        header: [
            { id: 'name', title: 'Item Name' },
            { id: 'itemId', title: 'Item ID' },
            { id: 'buyerName', title: 'Buyer Name' },
            { id: 'universalisUrl', title: 'Universalis URL' },
            { id: 'pricePerUnit', title: 'Price per unit' },
            { id: 'quantity', title: 'Quantity' },
            { id: 'timestamp', title: 'Timestamp' },
        ]
    });
    await maxBuyerCsvWriter.writeRecords(universalisMaxBuyEntries)
        .then(() => {
            console.log('Wrote max buyer CSV!')
        })
        .catch((err) => {
            console.error(`CSV writing error: `, err);
        });        
    return;
}

async function runGen() {
    const beforeMemory = process.memoryUsage().heapUsed;

    const distDirectoryPath = './dist/gh-pages/csv';
    if (!fs.existsSync(distDirectoryPath)) {
        fs.mkdirSync(distDirectoryPath, { recursive: true });
        console.log(`Directory structure created at ${distDirectoryPath}`);
      } else {
        console.log(`Directory structure already exists at ${distDirectoryPath}`);
      }

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