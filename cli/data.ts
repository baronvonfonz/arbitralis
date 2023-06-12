import sqlite3, { Database } from 'sqlite3';
import fs from 'fs';
const sqlite3Verbose = sqlite3.verbose();

const ITEMS_DB_FILE = `./cli/items.db`;
const DB_EXISTS = fs.existsSync(ITEMS_DB_FILE);
if (!DB_EXISTS) {
    throw Error(`items.db does not exist at location ${ITEMS_DB_FILE}`);
}
let db: Database | null = null;

type Item = {
    id: number;
    name: string;
}

type Recipe = {
    id: number;
    craftedItemId: number;
    craftedItemAmount: number;
    recipeLevel: number;
}

export function getDb(): Database {
    if (!db) {
        db = new sqlite3Verbose.Database(ITEMS_DB_FILE);
    }

    return db;
}

export function createItemsTable() {
    getDb().serialize(function() {
        getDb().run(`DROP TABLE IF EXISTS recipes_ingredients`);
        getDb().run(`DROP TABLE IF EXISTS recipes`);
        getDb().run(`DROP TABLE IF EXISTS items`);
        getDb().run('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT)');        
    });
}

export function createRecipesTable() {
    getDb().serialize(function() {
        getDb().run(`DROP TABLE IF EXISTS recipes_ingredients`);
        getDb().run(`DROP TABLE IF EXISTS recipes`);
        getDb().run(`
            CREATE TABLE IF NOT EXISTS recipes (
                id INTEGER,
                crafted_id INTEGER,
                crafted_amount INTEGER,
                recipe_level INTEGER,
                PRIMARY KEY(id),
                FOREIGN KEY (crafted_id) REFERENCES items(id)
            )
        `);
        getDb().run(`
            CREATE TABLE IF NOT EXISTS recipes_ingredients (
                recipe_id INTEGER,
                ingredient_id INTEGER,
                amount INTEGER,
                PRIMARY KEY(recipe_id, ingredient_id),
                FOREIGN KEY (ingredient_id) REFERENCES items(id),
                FOREIGN KEY (recipe_id) REFERENCES recipes(id)
            )
        `);
    });
}

export function insertItem({ id, name }: Item) {
    getDb().run('INSERT INTO items (id, name) VALUES (?, ?)', [id, name], function(err) {
        if (err) {
            console.error(err.message);
        } else {
            console.log(`A new item ${name} with ID ${this.lastID}`);
        }
    });
}

export function insertRecipe(
    { id, craftedItemId, craftedItemAmount, recipeLevel,}: Recipe,
    ingredientAmountPairs: Record<number, number>
) {
    getDb().serialize(function() {
        getDb().run(`
            INSERT INTO recipes (id, crafted_id, crafted_amount, recipe_level) VALUES (?, ?, ?, ?)
        `, [id, craftedItemId, craftedItemAmount, recipeLevel], function(err) {
            if (err) {
                console.error(err.message);
            } else {
                console.log(`A new recipe ${id}`);
            }
        });
        getDb().parallelize(function() {
            for (const ingredientId in ingredientAmountPairs) {
                const ingredientAmount = ingredientAmountPairs[ingredientId];
                getDb().run(`
                    INSERT INTO recipes_ingredients (recipe_id, ingredient_id, amount) VALUES (?, ?, ?)
                `, [id, ingredientId, ingredientAmount], function(err) {
                    if (err) {
                        console.error(err.message);
                    } else {
                        console.log(`A new recipe ingredient ${id} ${ingredientId}`);
                    }
                });        
            }
        });
    });
}

export type IngredientAmounts = Record<number, number>;
export type RecipeStrategy = {
    amount: number;
    ingredientAmounts: IngredientAmounts;
};
export type RecipeToIngredients = Record<number, RecipeStrategy>;
export type RecipesIngredientsMetadata = {
    recipesToIngredients: RecipeToIngredients;
    allItemIds: Set<number>;
}
export type RecipesIngredientsRow = {
    ingredientAmount: number;
    ingredientId: number;
    craftedId: number;
    craftedAmount: number;
}
export function getAllRecipesIngredients(itemIdstoInclude: number[] = []): Promise<RecipesIngredientsMetadata> {
    return new Promise<RecipesIngredientsMetadata>((resolve, reject) => {
        getDb().serialize(function() {
            getDb().all(`
                SELECT ri.ingredient_id as ingredientId, i2.id as craftedId, ri.amount as ingredientAmount, r.crafted_amount as craftedAmount       
                FROM recipes_ingredients ri
                JOIN items i
                    ON i.id = ri.ingredient_id
                JOIN recipes r
                    ON r.id = ri.recipe_id
                JOIN items i2
                    ON i2.id = r.crafted_id
               WHERE ri.ingredient_id IN (${itemIdstoInclude.join(',')})
                 AND r.crafted_id IN (${itemIdstoInclude.join(',')})
            ORDER BY craftedId desc;
            `, (error: Error, rows: RecipesIngredientsRow[]) => {
                if (error) {
                    reject(error);
                }
                console.log(`Found ${rows.length} recipe ingredients`);
                const allItemIds = new Set<number>();
                const recipesToIngredients: RecipeToIngredients = {};
                let currentCraftedId = -1;
                let currentCraftedAmount = -1;
                let currentIngredientsAmounts: Record<number, number> = {};
                rows.forEach((aRow, index) => {
                    if (aRow.craftedId !== currentCraftedId) {
                        recipesToIngredients[currentCraftedId] = {
                            ingredientAmounts: currentIngredientsAmounts,
                            amount: currentCraftedAmount,
                        };
                        currentIngredientsAmounts = {};
                        currentIngredientsAmounts[aRow.ingredientId] = aRow.ingredientAmount;
                        currentCraftedId = aRow.craftedId;
                        allItemIds.add(currentCraftedId);
                        Object.keys(currentIngredientsAmounts).forEach(ingredientId => allItemIds.add(Number(ingredientId)));
                    } else {
                        currentIngredientsAmounts[aRow.ingredientId] = aRow.ingredientAmount;
                        currentCraftedAmount = aRow.craftedAmount;
                    }
                });
                recipesToIngredients[currentCraftedId] = {
                    ingredientAmounts: currentIngredientsAmounts,
                    amount: currentCraftedAmount,
                };
                delete recipesToIngredients[-1];
                allItemIds.delete(-1);
                resolve({
                    allItemIds,
                    recipesToIngredients,
                });
            });
        });
    });
}

export async function getItemsById(itemIds: number[]): Promise<Item[]> {
    return new Promise<Item[]>((resolve, reject) => {
        getDb().serialize(function() {
            getDb().all(`
                SELECT i.id, i.name
                  FROM items i
                 WHERE i.id IN (${itemIds.join(',')})
            `, (error: Error, rows: Item[]) => {
                if (error) {
                    reject(error);
                }
                resolve(rows);
            });
        });    
    });
}