import { sequelize } from './config';

export const sequelizeMigrations = async () => {
    await sequelize().sync();
}