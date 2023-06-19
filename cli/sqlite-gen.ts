import axios from 'axios';
import fs from 'fs';
import { parse } from 'JSONStream';
import csv from 'csv-parser';
import { 
    createItemsTable,
    createRecipesTable,
    insertItem,    
    insertRecipe,
 } from './sqlite-query.js';

const ITEM_ID_MAPPING_LOCATION = 'https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/master/libs/data/src/lib/json/items.json';
const RECIPE_LOCATION = 'https://raw.githubusercontent.com/viion/ffxiv-datamining/master/csv/Recipe.csv';

const ITEMS_RAW_JSON_FILE = 'items_raw.json';
const RECIPES_RAW_CSV_FILE = 'recipes.csv';

export async function maybeFetch() {
    console.log('Refetching');
    await axios.get(ITEM_ID_MAPPING_LOCATION)
        .then((response) => {
            return fs.promises.writeFile(ITEMS_RAW_JSON_FILE, JSON.stringify(response.data), 'utf8');
        });
    await axios.get(RECIPE_LOCATION)
        .then((response) => {
            return fs.promises.writeFile(RECIPES_RAW_CSV_FILE, response.data, 'utf8');
        });
}

export async function maybeRegenItems(dropAll = false) {
    return new Promise<void>((resolve, reject) => {
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
    });
}

export async function maybeRegenRecipes(dropAll = false) {
    return new Promise<void>((resolve, reject) => {
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
    });
}