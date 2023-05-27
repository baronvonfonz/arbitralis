import { Sequelize } from "sequelize";

const ITEMS_DB_FILE = 'items.db';
let sequelizeInstance: Sequelize | undefined = undefined;
let authTested = false;

export const sequelize = () => {
    if (!sequelizeInstance) {
        sequelizeInstance = new Sequelize({
            dialect: 'sqlite',
            storage: ITEMS_DB_FILE
        });
    }

    return sequelizeInstance;
}

// const testAuth = () => {
//     if (!authTested) {
//         try {
//             await sequelizeInstance.authenticate();
//             console.log('Connection has been established successfully.');
//             authTested = true;
//         } catch (error) {
//             console.error('Unable to connect to the database:', error);
//         }
//     } 
// };