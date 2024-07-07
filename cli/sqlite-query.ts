import sqlite3, { Database } from 'sqlite3';
const sqlite3Verbose = sqlite3.verbose();

const ITEMS_DB_FILE = `./cli/items.db`;

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

export function createVentureItemsTable() {
    getDb().serialize(function() {
        getDb().run(`DROP TABLE IF EXISTS venture_items`);
        getDb().run(`
            CREATE TABLE IF NOT EXISTS venture_items (
                id INTEGER,
                amount_one INTEGER,
                amount_two INTEGER,
                amount_three INTEGER,
                amount_four INTEGER,
                amount_five INTEGER,
                PRIMARY KEY(id),
                FOREIGN KEY (id) REFERENCES items(id)
            )
        `);
    });
}

export function createShopItemsTable() {
    getDb().serialize(function() {
        getDb().run(`DROP TABLE IF EXISTS shop_items`);
        getDb().run(`
            CREATE TABLE IF NOT EXISTS shop_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER,
                item_amount INTEGER,
                cost_item_id INTEGER,
                cost_amount INTEGER,
                FOREIGN KEY (item_id) REFERENCES items(id)
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
    console.log(`inserting [${id}, ${craftedItemId}, ${craftedItemAmount}, ${recipeLevel}]`)
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

export type VentureItem = {
    id: number;
    amountOne: number;
    amountTwo: number;
    amountThree: number;
    amountFour: number;
    amountFive: number;
};
export function insertVentureItem(
    { id,    
      amountOne,
      amountTwo,
      amountThree,
      amountFour,
      amountFive
    }: VentureItem,
) {
    getDb().serialize(function() {
        getDb().run(`
            INSERT INTO venture_items (id, amount_one, amount_two, amount_three, amount_four, amount_five) VALUES (?, ?, ?, ?, ?, ?)
        `, [
            id,
            amountOne,
            amountTwo,
            amountThree,
            amountFour,
            amountFive
        ], function(err) {
            if (err) {
                console.error(err.message);
            } else {
                console.log(`A new venture item ${id}`);
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
export function getAllRecipesIngredients(): Promise<RecipesIngredientsMetadata> {
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
            ORDER BY craftedId desc;
            `, (error: Error, rows: RecipesIngredientsRow[]) => {
                if (error) {
                    reject(error);
                }
                const allItemIds = new Set<number>();
                const recipesToIngredients: RecipeToIngredients = {};
                let currentCraftedId = -1;
                let currentCraftedAmount = -1;
                let currentIngredientsAmounts: Record<number, number> = {};
                
                function updateDataStructures(nextCraftedId: number) {
                    recipesToIngredients[currentCraftedId] = {
                        ingredientAmounts: currentIngredientsAmounts,
                        amount: currentCraftedAmount,
                    };
                    allItemIds.add(currentCraftedId);
                    Object.keys(currentIngredientsAmounts).forEach(id => allItemIds.add(Number(id)));
                    currentIngredientsAmounts = {};
                    currentCraftedId = nextCraftedId;
                };

                rows.forEach((aRow) => {
                    if (aRow.craftedId !== currentCraftedId) {
                        updateDataStructures(aRow.craftedId);
                    }
                    currentIngredientsAmounts[aRow.ingredientId] = aRow.ingredientAmount;
                    currentCraftedAmount = aRow.craftedAmount;
                });

                updateDataStructures(-1);
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

export type ShopItem = {
    itemId: number;
    itemAmount: number;
    costItemId: number;
    costAmount: number;
};
export function insertShopItem(
    {
      itemId,    
      itemAmount,
      costItemId,
      costAmount,
    }: ShopItem,
) {
    getDb().serialize(function() {
        getDb().run(`
            INSERT INTO shop_items (item_id, item_amount, cost_item_id, cost_amount) VALUES (?, ?, ?, ?)
        `, [
            itemId,    
            itemAmount,
            costItemId,
            costAmount,
        ], function(err) {
            if (err) {
                console.error(err.message);
            } else {
                console.log(`A new shop item ${itemId}`);
            }
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

export async function getVentureItems(): Promise<VentureItem[]> {
    return new Promise<VentureItem[]>((resolve, reject) => {
        getDb().serialize(function() {
            getDb().all(`
                SELECT id, 
                       amount_one as amountOne,
                       amount_two as amountTwo,
                       amount_three as amountThree,
                       amount_four as amountFour,
                       amount_five as amountFive
                  FROM venture_items
            `, (error: Error, rows: VentureItem[]) => {
                if (error) {
                    reject(error);
                }
                resolve(rows);
            });
        });    
    });
}

export async function getShopItems(): Promise<ShopItem[]> {
    return new Promise<ShopItem[]>((resolve, reject) => {
        getDb().serialize(function() {
            getDb().all(`
                SELECT item_id as itemId,
                       item_amount as itemAmount,
                       cost_item_id as costItemId,
                       cost_amount as costAmount
                  FROM shop_items
            `, (error: Error, rows: ShopItem[]) => {
                if (error) {
                    reject(error);
                }
                resolve(rows);
            });
        });    
    });
}