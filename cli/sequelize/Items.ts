import { DataTypes } from 'sequelize';
import { sequelize } from './config';

export const Items = sequelize().define('items', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    name: DataTypes.STRING,
}, {
    timestamps: false,
});

