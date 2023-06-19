import axios from 'axios';
import fs from 'fs';
import csv from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import { 
    getAllRecipesIngredients,
    getItemsById,
    IngredientAmounts,
    RecipeStrategy,
 } from './sqlite-query.js';
 import { UniversalClient } from '../shared/index.js';
import { UniversalisV2 } from 'universalis-ts';
import { ObjectCsvWriterParams } from 'csv-writer/src/lib/csv-writer-factory.js';

const RETAINER_VENTURE_LOCATION = 'https://raw.githubusercontent.com/xivapi/ffxiv-datamining/e55e6d71d43999157db5a5cca94e7d596fd7088d/csv/RetainerTaskNormal.csv';
const RETAINER_VENTURE_LOCATION_CSV_FILE = 'retainer_task_normal.csv';

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
    regularSaleVelocity?: number;
    averagePricePerUnit?: number;
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

function getCsvWriterFieldNames(instanceOfObject: Record<string, string | number>): { id: string; title:string; }[] {
    const fieldNames = Object.keys(instanceOfObject);
    return fieldNames.map(name => ({ id: name, title: name }))
}

function universalisEntryEnrichedItem(item: Item, historyView?: UniversalisV2.components["schemas"]["HistoryView"]): 
    (UniversalisEnrichedItem & { maxPriceEntry: UniversalisV2.components["schemas"]["MinimizedSaleView"] | undefined }) 
{    
    const regularSaleVelocity = historyView?.regularSaleVelocity || 0;
    const sortedByPricePerUnit: UniversalisV2.components["schemas"]["MinimizedSaleView"][] = historyView?.entries?.sort(
        (leftEntry, rightEntry) => (leftEntry.pricePerUnit || 0) - (rightEntry.pricePerUnit || 0)
    ) || [];
    const maxPriceEntry = sortedByPricePerUnit[sortedByPricePerUnit.length - 1];
    const tenPercentOfEntries = Math.round(sortedByPricePerUnit.length * 0.1);
    // there's usually some whacko that's doing gil transfer, so if there are less than 10 sales chop off the top
    const trimmedEntries = tenPercentOfEntries > 0 ?
        sortedByPricePerUnit.slice(tenPercentOfEntries, sortedByPricePerUnit.length - tenPercentOfEntries) 
        :
        sortedByPricePerUnit.slice(0, sortedByPricePerUnit.length - 1);
    const sumOfPricePerUnit = trimmedEntries?.reduce((sum, saleEntry) => sum + (saleEntry.pricePerUnit || 0), 0);
    const averagePricePerUnit = Math.floor((sumOfPricePerUnit || 0) / trimmedEntries.length);

    return {
        ...item,
        maxPriceEntry,
        averagePricePerUnit: isNaN(averagePricePerUnit) ? 0 : averagePricePerUnit,
        regularSaleVelocity: regularSaleVelocity ? Number(regularSaleVelocity.toFixed(2)) : undefined,
        universalisUrl: `https://universalis.app/market/${item.itemId}`,
    };
}
const ventureItems: VentureItem[] = [];
const universalisEnrichedVentureItems: UniversalisEnrichedVentureItem[] = [];
const alreadyTrackedMaxBuys = new Set<number>();
const universalisMaxBuyEntries: UniversalisBuyEntryItem[] = [];
const universalisEnrichedRecipes: UniversalisEnrichedRecipe[] = [];

export async function generateCsvs() {
    await axios.get(RETAINER_VENTURE_LOCATION)
        .then((response) => {
            return fs.promises.writeFile(RETAINER_VENTURE_LOCATION_CSV_FILE, response.data, 'utf8');
        });
    const marketable = await UniversalClient.marketable();
    console.log(`There are currently ${marketable.length} marketable items`);
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

    const recipesIngredientsMetadata = await getAllRecipesIngredients();
    const allItemIdsToLookup: number[] = [...new Set([...(ventureItems.map(({ itemId }) => itemId)), ...recipesIngredientsMetadata.allItemIds])].sort();
    const itemIdToNameMap: Record<number,string> = (await getItemsById(allItemIdsToLookup))
        .reduce((idNameMap, item) => ({ [item.id]: item.name, ...idNameMap }), {});
    
    const historyViewsByItemId = await UniversalClient.historicalItemStats(allItemIdsToLookup);
    // Useful for debugging
    // await fs.promises.writeFile('temp.json', JSON.stringify(historyViewsByItemId, null, 2));
    if (!historyViewsByItemId) {
        throw Error('Could not make map of item stats');
    }

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
            averagePricePerUnit,
            regularSaleVelocity,
            universalisUrl,
        } = maybeEnrichedItem;
        universalisEnrichedVentureItems.push({
            ...ventureItem,
            regularSaleVelocity,
            averagePricePerUnit,
            amountOneTotalPrice: averagePricePerUnit ? averagePricePerUnit * ventureItem.amountOne : 0,
            universalisUrl,
            name: itemIdToNameMap[ventureItem.itemId]
        });
    });
    await writeCsvSync({
        path: 'dist/gh-pages/csv/venture_items_stats.csv',
        header: getCsvWriterFieldNames(universalisEnrichedVentureItems[0])
    }, universalisEnrichedVentureItems);

    ventureItems.splice(0);

    function addMaxPriceEntry(item: UniversalisEnrichedItem, maxPriceEntry: UniversalisV2.components["schemas"]["MinimizedSaleView"]) {
        if (alreadyTrackedMaxBuys.has(item.itemId)) {
            return;
        }

        alreadyTrackedMaxBuys.add(item.itemId);

        universalisMaxBuyEntries.push({
            itemId: item.itemId,
            name: itemIdToNameMap[item.itemId],
            buyerName: maxPriceEntry.buyerName || 'N/A',
            pricePerUnit: maxPriceEntry.pricePerUnit || 0,
            quantity: maxPriceEntry.quantity || 0,
            timestamp: maxPriceEntry.timestamp ? new Date(maxPriceEntry.timestamp * 1000).toISOString() : 'N/A',
            universalisUrl: item.universalisUrl,
        })
    }

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

        const { maxPriceEntry: craftedMaxPriceEntry } = maybeEnrichedCraftedItem;

        if (craftedMaxPriceEntry) {
            addMaxPriceEntry(maybeEnrichedCraftedItem, craftedMaxPriceEntry);
        }

        const ingredientsEnriched: UniversalisEnrichedItemAmount[] = [];
        Object.keys(ingredientAmounts).forEach((rawItemId) => {
            const ingredientItemId = Number(rawItemId);
            const amount = ingredientAmounts[ingredientItemId];
            const ingredientHistoryView = historyViewsByItemId[ingredientItemId];
            if (!ingredientHistoryView) {
                console.log(`Missing history for ${itemIdToNameMap[ingredientItemId]} - ${ingredientItemId}`)
            }
            const { maxPriceEntry, ...enrichedItem } = universalisEntryEnrichedItem({
                itemId: ingredientItemId,
                name: itemIdToNameMap[ingredientItemId] 
            }, ingredientHistoryView);

            ingredientsEnriched.push({
                ...enrichedItem,
                amount,
            });

            if (maxPriceEntry) {
                addMaxPriceEntry(enrichedItem, maxPriceEntry);
            }
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
            ingredientOne_universalisUrl: ingredientsEnriched[0]?.universalisUrl,
            ingredientOne_amount: ingredientsEnriched[0]?.amount,

            ingredientTwo_name: ingredientsEnriched[1]?.name,
            ingredientTwo_itemId: ingredientsEnriched[1]?.itemId,
            ingredientTwo_averagePricePerUnit: ingredientsEnriched[1]?.averagePricePerUnit,
            ingredientTwo_regularSaleVelocity: ingredientsEnriched[1]?.regularSaleVelocity,
            ingredientTwo_universalisUrl: ingredientsEnriched[1]?.universalisUrl,
            ingredientTwo_amount: ingredientsEnriched[1]?.amount,

            ingredientThree_name: ingredientsEnriched[2]?.name,
            ingredientThree_itemId: ingredientsEnriched[2]?.itemId,
            ingredientThree_averagePricePerUnit: ingredientsEnriched[2]?.averagePricePerUnit,
            ingredientThree_regularSaleVelocity: ingredientsEnriched[2]?.regularSaleVelocity,
            ingredientThree_universalisUrl: ingredientsEnriched[2]?.universalisUrl,
            ingredientThree_amount: ingredientsEnriched[2]?.amount,

            ingredientFour_name: ingredientsEnriched[3]?.name,
            ingredientFour_itemId: ingredientsEnriched[3]?.itemId,
            ingredientFour_averagePricePerUnit: ingredientsEnriched[3]?.averagePricePerUnit,
            ingredientFour_regularSaleVelocity: ingredientsEnriched[3]?.regularSaleVelocity,
            ingredientFour_universalisUrl: ingredientsEnriched[3]?.universalisUrl,
            ingredientFour_amount: ingredientsEnriched[3]?.amount,

            ingredientFive_name: ingredientsEnriched[4]?.name,
            ingredientFive_itemId: ingredientsEnriched[4]?.itemId,
            ingredientFive_averagePricePerUnit: ingredientsEnriched[4]?.averagePricePerUnit,
            ingredientFive_regularSaleVelocity: ingredientsEnriched[4]?.regularSaleVelocity,
            ingredientFive_universalisUrl: ingredientsEnriched[4]?.universalisUrl,
            ingredientFive_amount: ingredientsEnriched[4]?.amount,

            ingredientSix_name: ingredientsEnriched[5]?.name,
            ingredientSix_itemId: ingredientsEnriched[5]?.itemId,
            ingredientSix_averagePricePerUnit: ingredientsEnriched[5]?.averagePricePerUnit,
            ingredientSix_regularSaleVelocity: ingredientsEnriched[5]?.regularSaleVelocity,
            ingredientSix_universalisUrl: ingredientsEnriched[5]?.universalisUrl,
            ingredientSix_amount: ingredientsEnriched[5]?.amount,

            ingredientSeven_name: ingredientsEnriched[6]?.name,
            ingredientSeven_itemId: ingredientsEnriched[6]?.itemId,
            ingredientSeven_averagePricePerUnit: ingredientsEnriched[6]?.averagePricePerUnit,
            ingredientSeven_regularSaleVelocity: ingredientsEnriched[6]?.regularSaleVelocity,
            ingredientSeven_universalisUrl: ingredientsEnriched[6]?.universalisUrl,
            ingredientSeven_amount: ingredientsEnriched[6]?.amount,

            ingredientEight_name: ingredientsEnriched[7]?.name,
            ingredientEight_itemId: ingredientsEnriched[7]?.itemId,
            ingredientEight_averagePricePerUnit: ingredientsEnriched[7]?.averagePricePerUnit,
            ingredientEight_regularSaleVelocity: ingredientsEnriched[7]?.regularSaleVelocity,
            ingredientEight_universalisUrl: ingredientsEnriched[7]?.universalisUrl,
            ingredientEight_amount: ingredientsEnriched[7]?.amount,

            ingredientNine_name: ingredientsEnriched[8]?.name,
            ingredientNine_itemId: ingredientsEnriched[8]?.itemId,
            ingredientNine_averagePricePerUnit: ingredientsEnriched[8]?.averagePricePerUnit,
            ingredientNine_regularSaleVelocity: ingredientsEnriched[8]?.regularSaleVelocity,
            ingredientNine_universalisUrl: ingredientsEnriched[8]?.universalisUrl,
            ingredientNine_amount: ingredientsEnriched[8]?.amount,

            craftingOutcomeInGil: Math.floor((maybeEnrichedCraftedItem.averagePricePerUnit || 0) * recipeStrategy.amount) - ingredientsEnriched.reduce(
                (ingredientCostSum, ingredient) => ingredientCostSum + Math.floor((ingredient.averagePricePerUnit || 0) * ingredient.amount)
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

    await writeCsvSync({
        path: 'dist/gh-pages/csv/max_buyer_items_stats.csv',
        header: getCsvWriterFieldNames(universalisMaxBuyEntries[0])
    }, universalisMaxBuyEntries);

    return;
}
