import axios from 'axios';
import fs from 'fs';
import { parse } from 'JSONStream';
import csv from 'csv-parser';
import { 
    createItemsTable,
    createRecipesTable,
    createShopItemsTable,
    createVentureItemsTable,
    insertItem,    
    insertRecipe,
    insertShopItem,
    insertVentureItem,
 } from './sqlite-query.js';

const ITEM_ID_TO_NAME_MAPPING_LOCATION = 'https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/master/libs/data/src/lib/json/items.json';
const ITEM_ID_TO_ILVL_MAPPING_LOCATION = 'https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/staging/libs/data/src/lib/json/ilvls.json';
const RECIPE_LOCATION = 'https://raw.githubusercontent.com/viion/ffxiv-datamining/master/csv/Recipe.csv';
const RETAINER_VENTURE_LOCATION = 'https://raw.githubusercontent.com/xivapi/ffxiv-datamining/master/csv/RetainerTaskNormal.csv';
const SPECIAL_SHOP_LOCATION = 'https://raw.githubusercontent.com/xivapi/ffxiv-datamining/master/csv/SpecialShop.csv';

const ITEMS_RAW_JSON_FILE = 'items_raw.json';
const ILVLS_RAW_JSON_FILE = 'ilvls_raw.json';
const RECIPES_RAW_CSV_FILE = 'recipes.csv';
const RETAINER_VENTURE_LOCATION_CSV_FILE = 'retainer_task_normal.csv';
const SPECIAL_SHOP_LOCATION_CSV_FILE = 'special_shop.csv';

async function fetchFiles() {
    const axiosInstance = axios.create({
        timeout: 60_000,
    })
    console.log(`Refetching ${ITEM_ID_TO_NAME_MAPPING_LOCATION}`);
    await axiosInstance.get(ITEM_ID_TO_NAME_MAPPING_LOCATION)
        .then((response) => {
            return fs.promises.writeFile(ITEMS_RAW_JSON_FILE, JSON.stringify(response.data), 'utf8');
        });
    await new Promise(resolve => setTimeout(resolve, 30_000));

    console.log(`Refetching ${ITEM_ID_TO_ILVL_MAPPING_LOCATION}`);
    await axiosInstance.get(ITEM_ID_TO_ILVL_MAPPING_LOCATION)
        .then((response) => {
            return fs.promises.writeFile(ILVLS_RAW_JSON_FILE, JSON.stringify(response.data), 'utf8');
        });
    await new Promise(resolve => setTimeout(resolve, 30_000));

    console.log(`Refetching ${RECIPE_LOCATION}`);
    await axiosInstance.get(RECIPE_LOCATION)
        .then((response) => {
            return fs.promises.writeFile(RECIPES_RAW_CSV_FILE, response.data, 'utf8');
        });
    await new Promise(resolve => setTimeout(resolve, 30_000));

    console.log(`Refetching ${RETAINER_VENTURE_LOCATION}`);
    await axiosInstance.get(RETAINER_VENTURE_LOCATION)
        .then((response) => {
            return fs.promises.writeFile(RETAINER_VENTURE_LOCATION_CSV_FILE, response.data, 'utf8');
        });        
    await new Promise(resolve => setTimeout(resolve, 30_000));

    console.log(`Refetching ${SPECIAL_SHOP_LOCATION}`);
    await axiosInstance.get(SPECIAL_SHOP_LOCATION)
        .then((response) => {
            return fs.promises.writeFile(SPECIAL_SHOP_LOCATION_CSV_FILE, response.data, 'utf8');
        });                
}

async function getIlvlMap() {
    return new Promise<Map<number, number>>((resolve, reject) => {
        const rawReadStream = fs.createReadStream(ILVLS_RAW_JSON_FILE, 'utf8');
        const jsonParser = parse('$*');
        rawReadStream.pipe(jsonParser);

        const idToIlvlMap = new Map<number, number>();

        jsonParser.on('data', (data) => {
            if (data) {
                idToIlvlMap.set(Number(data.key), Number(data.value));
            }
        });

        jsonParser.on('end', () => {
            console.log('Items done');
            resolve(idToIlvlMap);
        });

    });
}

async function regenBaseItems(dropAll = false) {
    const idToIlvlMap = await getIlvlMap();

    return new Promise<void>((resolve, reject) => {
        if (dropAll) {
            createItemsTable();
        }
        
        const rawReadStream = fs.createReadStream(ITEMS_RAW_JSON_FILE, 'utf8');
        const jsonParser = parse('$*');
        rawReadStream.pipe(jsonParser);

        jsonParser.on('data', (data) => {
            const itemData = data.value;

            if (itemData.en) {
                insertItem({ id: data.key, name: itemData.en, ilvl: idToIlvlMap.get(Number(data.key)) ?? 0 });
            }
        });
        jsonParser.on('end', () => {
            console.log('Items done');
            resolve();
        });
    });
}

async function regenRecipes(dropAll = false) {
    return new Promise<void>((resolve, reject) => {
        if (dropAll) {
            createRecipesTable();
        }
        const rawReadStream = fs.createReadStream(RECIPES_RAW_CSV_FILE, 'utf8');
        rawReadStream.pipe(csv({ skipLines: 1 }))
            .on('data', (data) => {
                const craftedItemId = data['Item{Result}'];

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
                    console.log(`Failed to determine ingredient amounts for ${craftedItemId}`);
                    return;
                }

                // 7/7/2024 -> prior the 'Number' column was unique, now '#' is the 'row id' it seems
                const recipeId = data['#'];
                const craftedItemAmount = data['Amount{Result}'];
                const recipeLevel = data['RecipeLevelTable'];

                insertRecipe({ 
                    id: recipeId,
                    craftedItemId,
                    craftedItemAmount,
                    recipeLevel,
                }, ingredientAmountPairs);
            })
            .on('end', () => {
                console.log('Recipes done');
                resolve();
            });
    });
}

async function regenVentureItems(dropAll = false) {
    return new Promise<void>((resolve, reject) => {
        if (dropAll) {
            createVentureItemsTable();
        }
        const rawReadStream = fs.createReadStream(RETAINER_VENTURE_LOCATION_CSV_FILE, 'utf8');
        rawReadStream.pipe(csv({ skipLines: 1 }))
        .on('data', (data) => {
            const id = Number(data[`Item`]);
            const itemQuantityBreakpoints: number[] = [];
            for (let i = 0; i < 5; i++) {
                itemQuantityBreakpoints.push(data[`Quantity[${i}]`]);
            }
            insertVentureItem({
                id,
                amountOne: itemQuantityBreakpoints[0],
                amountTwo: itemQuantityBreakpoints[1],
                amountThree: itemQuantityBreakpoints[2],
                amountFour: itemQuantityBreakpoints[3],
                amountFive: itemQuantityBreakpoints[4],
            })
        })
        .on('end', () => {
            console.log('Venture items done');
            resolve();
        });
    });
}


async function regenShopItems(dropAll = false) {
    return new Promise<void>((resolve, reject) => {
        if (dropAll) {
            createShopItemsTable();
        }
        const rawReadStream = fs.createReadStream(SPECIAL_SHOP_LOCATION_CSV_FILE, 'utf8');
        rawReadStream.pipe(csv({ skipLines: 1 }))
        .on('data', (data) => {
            // beeeg columns (60 per, sometimes there are items with multiple received/costs which we are ignoring for now)
            for (let i = 0; i < 60; i++) {
                const itemId = data[`Item{Receive}[${i}][0]`];
                const itemAmount = data[`Count{Receive}[${i}][0]`];
                const costItemId = data[`Item{Cost}[${i}][0]`];
                const costAmount = data[`Count{Cost}[${i}][0]`];

                const skipIfTwoItemsReceived = data[`Item{Receive}[${i}][1]`];
                const skipIfTwoItemsCost = data[`Item{Cost}[${i}][1]`];

                if (Number(itemId) === 0) {
                    console.log('No item received, skipping');
                    continue;
                }

                if (Number(skipIfTwoItemsCost) !== 0 || Number(skipIfTwoItemsReceived) !== 0) {
                    console.log(`Skipping cost/receive ${skipIfTwoItemsCost} - ${skipIfTwoItemsReceived}`);
                    continue;
                }

                insertShopItem({
                    itemId,
                    itemAmount,
                    costItemId,
                    costAmount,
                });
            }
        })
        .on('end', () => {
            console.log('Shop items done');
            resolve();
        });
    });
}

export async function regenAll(dropAll = false) {
    await fetchFiles();
    await regenBaseItems(dropAll);
    await regenRecipes(dropAll);
    await regenVentureItems(dropAll);
    await regenShopItems(dropAll);
}