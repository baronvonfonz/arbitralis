import createClient, { FetchOptions } from 'openapi-fetch';
import { UniversalisV2 } from 'universalis-ts';

const { get } = createClient<UniversalisV2.paths>({ baseUrl: 'https://universalis.app'});

async function worlds() {
    const results = await get('/api/v2/worlds', {});
    results.data?.forEach(world => {
        if (world.name == 'Jenova') {
            // Jenova is 40
            console.log(world);
        }
    });
}

const _28_DAYS_SECONDS = 28 * 24 * 60 * 60;
const _28_DAYS_MILLISECONDS = _28_DAYS_SECONDS * 1000;

async function itemStats(itemIds: number[], worldDcRegion = 40,) {
    if (itemIds.length > 100) {
        throw Error('API allows only 100 items at a time');
    }
    
    const results = await get('/api/v2/history/{worldDcRegion}/{itemIds}', {
        params: {
            query: {
                statsWithin: Number(_28_DAYS_MILLISECONDS).toString(),
                entriesWithin: Number(_28_DAYS_SECONDS).toString(),
            },
            path: {
                worldDcRegion: worldDcRegion.toString(),
                itemIds: itemIds.join(','),
            }
        }
    });

    const { data, error } = results;

    if (error) {
        throw Error(JSON.stringify(error));
    }

    if (!data) {
        throw Error('Null response?');
    }

    const { items, unresolvedItems } = results.data;
    
    if (unresolvedItems?.length) {
        throw Error(`Bad item IDs were passed: ${unresolvedItems}`);
    }

    return items;
}

async function marketable() {
    const results = await get('/api/v2/marketable', {});
    const { data, error } = results;

    if (error) {
        throw Error(JSON.stringify(error));
    }

    if (!data) {
        throw Error('Null response?');
    }
    return data;
}

export { itemStats, marketable };

// itemStats([30000,30001,30002,30003,30004]);
// marketable();
