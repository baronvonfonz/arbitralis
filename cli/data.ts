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

export function createItemsVolumesTable() {
    getDb().serialize(function() {
        getDb().run(`DROP TABLE IF EXISTS items_volumes`);
        getDb().run(`CREATE TABLE IF NOT EXISTS items_volumes (
            item_id INTEGER,
            start_epoch INTEGER,
            end_epoch INTEGER,
            units INTEGER,
            gil INTEGER,
            PRIMARY KEY(item_id, from_id),
        )`);        
    });
}

type RecipesIngredientsRow = {
    ingredientId: number;
    ingredientName: string;
    craftedName: string;
    craftedId: number;
}
export function getAllRecipesIngredients(resultsFunc: (error: Error, rows: RecipesIngredientsRow[]) => void) {
    getDb().serialize(function() {
        getDb().all(`
            SELECT ri.ingredient_id as ingredientId, i.name as ingredientName, i2.name as craftedName, i2.id as craftedId        
              FROM recipes_ingredients ri
              JOIN items i
                ON i.id = ri.ingredient_id
              JOIN recipes r
                ON r.id = ri.recipe_id
              JOIN items i2
                ON i2.id = r.crafted_id
          ORDER BY 1 desc;
        `, resultsFunc);
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
                console.log('returning');
                if (error) {
                    reject(error);
                }
                resolve(rows);
            });
        });    
    });
}