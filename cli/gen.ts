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
    IngredientAmounts,
    RecipeStrategy,
 } from './data.js';
 import { UniversalClient } from '../shared/index.js';
import { UniversalisV2 } from 'universalis-ts';
import { ObjectCsvWriterParams } from 'csv-writer/src/lib/csv-writer-factory.js';

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

async function writeCsvSync(csvOptions: ObjectCsvWriterParams, records: any) {
    const csvWriter = createObjectCsvWriter(csvOptions);
    await csvWriter.writeRecords(records)
        .then(() => {
            console.log('Wrote CSV!')
        })
        .catch((err) => {
            console.error(`CSV writing error: `, err);
        });    
}

type Item = {
    itemId: number;
    name: string;
};
type VentureItem = {
    itemId: number;
    amountOne: number;
    amountTwo: number;
    amountThree: number;
    amountFour: number;
    amountFive: number;
};
type UniversalisEnrichedItem = {
    regularSaleVelocity: number;
    averagePricePerUnit: number;
    universalisUrl: string;
} & Item;
type UniversalisEnrichedVentureItem = {
    amountOneTotalPrice: number;    
} & VentureItem & Item & UniversalisEnrichedItem;
type UniversalisBuyEntryItem = {
    pricePerUnit: number;
    quantity: number;
    buyerName: string;
    timestamp: string;
    universalisUrl: string;
} & Item;
type UniversalisEnrichedItemAmount = {
    amount: number;
} & UniversalisEnrichedItem;
type PrefixedType<T, Prefix extends string> = {
    [K in keyof T as `${Prefix}${string & K}`]: T[K];
};
type UniversalisEnrichedRecipe = {
    craftingOutcomeInGil: number;
} & PrefixedType<UniversalisEnrichedItemAmount, "crafted_">
& Partial<PrefixedType<UniversalisEnrichedItemAmount, "ingredientOne_">>
& Partial<PrefixedType<UniversalisEnrichedItemAmount, "ingredientTwo_">>
& Partial<PrefixedType<UniversalisEnrichedItemAmount, "ingredientThree_">>
& Partial<PrefixedType<UniversalisEnrichedItemAmount, "ingredientFour_">>
& Partial<PrefixedType<UniversalisEnrichedItemAmount, "ingredientFive_">>
& Partial<PrefixedType<UniversalisEnrichedItemAmount, "ingredientSix_">>
& Partial<PrefixedType<UniversalisEnrichedItemAmount, "ingredientSeven_">>
& Partial<PrefixedType<UniversalisEnrichedItemAmount, "ingredientEight_">>
& Partial<PrefixedType<UniversalisEnrichedItemAmount, "ingredientNine_">>;
function universalisEntryEnrichedItem(item: Item, historyView: UniversalisV2.components["schemas"]["HistoryView"]): 
    (UniversalisEnrichedItem & { maxPriceEntry: UniversalisV2.components["schemas"]["MinimizedSaleView"] }) | undefined 
{
    if (!historyView) {
        console.log(`No data from universalis for ${item.itemId}`);
        return undefined;
    }
    if ((historyView?.entries?.length || 0) === 0) {
        console.log(`No buys for (id:${item.itemId})`);
        return undefined;
    }
    
    const regularSaleVelocity = historyView.regularSaleVelocity || 0;
    // prepare trimmed mean
    const sortedByPricePerUnit: UniversalisV2.components["schemas"]["MinimizedSaleView"][] = historyView?.entries?.sort(
        (leftEntry, rightEntry) => (leftEntry.pricePerUnit || 0) - (rightEntry.pricePerUnit || 0)
    ) || [];
    const maxPriceEntry = sortedByPricePerUnit[sortedByPricePerUnit.length - 1];
    const tenPercentOfEntries = Math.round(sortedByPricePerUnit.length * 0.1);
    const trimmedEntries = sortedByPricePerUnit.slice(tenPercentOfEntries, sortedByPricePerUnit.length - tenPercentOfEntries);

    // calculate trimmed mean
    
    const sumOfPricePerUnit = trimmedEntries?.reduce((sum, saleEntry) => sum + (saleEntry.pricePerUnit || 0), 0);
    const averagePricePerUnit = Math.floor((sumOfPricePerUnit || 0) / trimmedEntries.length);
    if (isNaN(averagePricePerUnit) || !maxPriceEntry.buyerName) {
        console.log(`NaN calc for ${item.itemId}`);
        return undefined;
    }
    return {
        ...item,
        maxPriceEntry,
        averagePricePerUnit,
        regularSaleVelocity,
        universalisUrl: `https://universalis.app/market/${item.itemId}`,
    };
}
const ventureItems: VentureItem[] = [];
const universalisEnrichedVentureItems: UniversalisEnrichedVentureItem[] = [];
const universalisMaxBuyEntries: UniversalisBuyEntryItem[] = [];
const universalisEnrichedRecipes: UniversalisEnrichedRecipe[] = [];

async function generateCsvs() {
    if (!ventures) {
        console.log('Not generating ventures stats');
        return;
    }
    await axios.get(RETAINER_VENTURE_LOCATION)
        .then((response) => {
            return fs.promises.writeFile(RETAINER_VENTURE_LOCATION_CSV_FILE, response.data, 'utf8');
        });
    const marketable = await UniversalClient.marketable();
    console.log(`There are currently ${marketable.length} items`);
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

    const recipesIngredientsMetadata = await getAllRecipesIngredients(marketable);
    // await fs.promises.writeFile('temp.json', JSON.stringify(recipesIngredientsMetadata, null, 2));
    const allItemIdsToLookup: number[] = [...(ventureItems.map(({ itemId }) => itemId)), ...recipesIngredientsMetadata.allItemIds];
    const historyViewsByItemId = await UniversalClient.historicalItemStats(allItemIdsToLookup);
    // Useful for debugging
    // await fs.promises.writeFile('temp.json', JSON.stringify(historyViewsByItemId, null, 2));
    if (!historyViewsByItemId) {
        throw Error('Could not make map of item stats');
    }

    const itemIdToNameMap: Record<number,string> = (await getItemsById(allItemIdsToLookup.flat()))
        .reduce((idNameMap, item) => ({ [item.id]: item.name, ...idNameMap }), {});

    ventureItems.forEach((ventureItem) => {
        const historyView = historyViewsByItemId[ventureItem.itemId];
        const name = itemIdToNameMap[ventureItem.itemId];

        if (!historyView) {
            return;
        }

        const maybeEnrichedItem = universalisEntryEnrichedItem({ ...ventureItem, name }, historyView);

        if (!maybeEnrichedItem) {
            return;
        }

        const {
            maxPriceEntry,
            averagePricePerUnit,
            regularSaleVelocity,
            universalisUrl,
        } = maybeEnrichedItem;
        universalisEnrichedVentureItems.push({
            ...ventureItem,
            regularSaleVelocity,
            averagePricePerUnit,
            amountOneTotalPrice: averagePricePerUnit * ventureItem.amountOne,
            universalisUrl,
            name: itemIdToNameMap[ventureItem.itemId]
        });
        universalisMaxBuyEntries.push({
            itemId: ventureItem.itemId,
            name: itemIdToNameMap[ventureItem.itemId],
            buyerName: maxPriceEntry.buyerName || 'N/A',
            pricePerUnit: maxPriceEntry.pricePerUnit || 0,
            quantity: maxPriceEntry.quantity || 0,
            timestamp: maxPriceEntry.timestamp ? new Date(maxPriceEntry.timestamp * 1000).toISOString() : 'N/A',
            universalisUrl,
        })
    });
    await writeCsvSync({
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
            { id: 'averagePricePerUnit', title: 'Average Price Per Unit' },
            { id: 'amountOneTotalPrice', title: 'Total Per Venture (min amount)' },
        ]
    }, universalisEnrichedVentureItems);

    await writeCsvSync({
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
    }, universalisMaxBuyEntries);

    ventureItems.splice(0);
    universalisMaxBuyEntries.splice(0);

    Object.keys(recipesIngredientsMetadata.recipesToIngredients).forEach(craftedItemId => {
        const recipeStrategy: RecipeStrategy = recipesIngredientsMetadata.recipesToIngredients[Number(craftedItemId)];
        const ingredientAmounts: IngredientAmounts = recipeStrategy.ingredientAmounts;
        const craftedHistoryView = historyViewsByItemId[craftedItemId];
        const craftedName = itemIdToNameMap[Number(craftedItemId)];
        if (!craftedHistoryView) {
            return;
        }

        const maybeEnrichedCraftedItem = universalisEntryEnrichedItem({ itemId: Number(craftedItemId), name: craftedName }, craftedHistoryView);

        if (!maybeEnrichedCraftedItem) {
            return;
        }

        // TODO: this stanks
        const ingredientsEnriched: UniversalisEnrichedItemAmount[] = [];
        Object.keys(ingredientAmounts).forEach((rawItemId) => {
            const ingredientItemId = Number(rawItemId);
            const amount = ingredientAmounts[ingredientItemId];
            const ingredientHistoryView = historyViewsByItemId[ingredientItemId];
            if (!ingredientHistoryView) {
                return;
            }
            const maybeEnrichedIngredientItem = universalisEntryEnrichedItem({ itemId: ingredientItemId, name: itemIdToNameMap[ingredientItemId] }, ingredientHistoryView);
            if (!maybeEnrichedIngredientItem) {
                return;
            }

            ingredientsEnriched.push({
                ...maybeEnrichedIngredientItem,
                amount,
            });
        });

        // TODO: I am not proud of this abomination
        universalisEnrichedRecipes.push({
            crafted_name: craftedName,
            crafted_itemId: Number(craftedItemId),
            crafted_averagePricePerUnit: maybeEnrichedCraftedItem.averagePricePerUnit,
            crafted_regularSaleVelocity: maybeEnrichedCraftedItem.regularSaleVelocity,
            crafted_universalisUrl: maybeEnrichedCraftedItem.universalisUrl,
            crafted_amount: recipeStrategy.amount,
            
            ingredientOne_name: ingredientsEnriched[0]?.name,
            ingredientOne_itemId: ingredientsEnriched[0]?.itemId,
            ingredientOne_averagePricePerUnit: ingredientsEnriched[0]?.averagePricePerUnit,
            ingredientOne_regularSaleVelocity: ingredientsEnriched[0]?.regularSaleVelocity,
            ingredientOne_universalisUrl: ingredientsEnriched[0]?.name,
            ingredientOne_amount: ingredientsEnriched[0]?.amount,

            ingredientTwo_name: ingredientsEnriched[1]?.name,
            ingredientTwo_itemId: ingredientsEnriched[1]?.itemId,
            ingredientTwo_averagePricePerUnit: ingredientsEnriched[1]?.averagePricePerUnit,
            ingredientTwo_regularSaleVelocity: ingredientsEnriched[1]?.regularSaleVelocity,
            ingredientTwo_universalisUrl: ingredientsEnriched[1]?.name,
            ingredientTwo_amount: ingredientsEnriched[1]?.amount,

            ingredientThree_name: ingredientsEnriched[2]?.name,
            ingredientThree_itemId: ingredientsEnriched[2]?.itemId,
            ingredientThree_averagePricePerUnit: ingredientsEnriched[2]?.averagePricePerUnit,
            ingredientThree_regularSaleVelocity: ingredientsEnriched[2]?.regularSaleVelocity,
            ingredientThree_universalisUrl: ingredientsEnriched[2]?.name,
            ingredientThree_amount: ingredientsEnriched[2]?.amount,

            ingredientFour_name: ingredientsEnriched[3]?.name,
            ingredientFour_itemId: ingredientsEnriched[3]?.itemId,
            ingredientFour_averagePricePerUnit: ingredientsEnriched[3]?.averagePricePerUnit,
            ingredientFour_regularSaleVelocity: ingredientsEnriched[3]?.regularSaleVelocity,
            ingredientFour_universalisUrl: ingredientsEnriched[3]?.name,
            ingredientFour_amount: ingredientsEnriched[3]?.amount,

            ingredientFive_name: ingredientsEnriched[4]?.name,
            ingredientFive_itemId: ingredientsEnriched[4]?.itemId,
            ingredientFive_averagePricePerUnit: ingredientsEnriched[4]?.averagePricePerUnit,
            ingredientFive_regularSaleVelocity: ingredientsEnriched[4]?.regularSaleVelocity,
            ingredientFive_universalisUrl: ingredientsEnriched[4]?.name,
            ingredientFive_amount: ingredientsEnriched[4]?.amount,

            ingredientSix_name: ingredientsEnriched[5]?.name,
            ingredientSix_itemId: ingredientsEnriched[5]?.itemId,
            ingredientSix_averagePricePerUnit: ingredientsEnriched[5]?.averagePricePerUnit,
            ingredientSix_regularSaleVelocity: ingredientsEnriched[5]?.regularSaleVelocity,
            ingredientSix_universalisUrl: ingredientsEnriched[5]?.name,
            ingredientSix_amount: ingredientsEnriched[5]?.amount,

            ingredientSeven_name: ingredientsEnriched[6]?.name,
            ingredientSeven_itemId: ingredientsEnriched[6]?.itemId,
            ingredientSeven_averagePricePerUnit: ingredientsEnriched[6]?.averagePricePerUnit,
            ingredientSeven_regularSaleVelocity: ingredientsEnriched[6]?.regularSaleVelocity,
            ingredientSeven_universalisUrl: ingredientsEnriched[6]?.name,
            ingredientSeven_amount: ingredientsEnriched[6]?.amount,

            ingredientEight_name: ingredientsEnriched[7]?.name,
            ingredientEight_itemId: ingredientsEnriched[7]?.itemId,
            ingredientEight_averagePricePerUnit: ingredientsEnriched[7]?.averagePricePerUnit,
            ingredientEight_regularSaleVelocity: ingredientsEnriched[7]?.regularSaleVelocity,
            ingredientEight_universalisUrl: ingredientsEnriched[7]?.name,
            ingredientEight_amount: ingredientsEnriched[7]?.amount,

            ingredientNine_name: ingredientsEnriched[8]?.name,
            ingredientNine_itemId: ingredientsEnriched[8]?.itemId,
            ingredientNine_averagePricePerUnit: ingredientsEnriched[8]?.averagePricePerUnit,
            ingredientNine_regularSaleVelocity: ingredientsEnriched[8]?.regularSaleVelocity,
            ingredientNine_universalisUrl: ingredientsEnriched[8]?.name,
            ingredientNine_amount: ingredientsEnriched[8]?.amount,

            craftingOutcomeInGil: Math.floor(maybeEnrichedCraftedItem.averagePricePerUnit * recipeStrategy.amount) - ingredientsEnriched.reduce(
                (ingredientCostSum, ingredient) => ingredientCostSum +  Math.floor(ingredient.averagePricePerUnit * ingredient.amount)
            , 0),
        });
    });

    console.log(universalisEnrichedRecipes.length);

    const fieldNames: string[] = Object.keys(universalisEnrichedRecipes[0]);
    await writeCsvSync({
        path: 'dist/gh-pages/csv/recipe_item_stats.csv',
        header: [
            { id: 'craftingOutcomeInGil', title: `craftingOutcomeInGil` },
            ...fieldNames.map(name => ({ id: name, title: name })),
        ]
    }, universalisEnrichedRecipes);

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

    // await maybeFetch();
    // await maybeRegenItems();
    // await maybeRegenRecipes();
    // await maybeGetRecipePrices();
    await generateCsvs();
    // UniversalClient.historyViewsByItemId([34343,34344,34344]);

    const afterMemory = process.memoryUsage().heapUsed;

    console.log(`Finished, before memory: ${beforeMemory} after ${afterMemory}`);
}

runGen();