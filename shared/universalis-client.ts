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

async function itemStats(itemIds: number[], worldDcRegion = 40,) {
    const results = await get('/api/v2/history/{worldDcRegion}/{itemIds}', {
        params: {
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

    console.log(items);
}

async function marketable() {
    const results = await get('/api/v2/marketable', {});
    console.log(results.data);
}

export { itemStats, marketable };

// itemStats([30000,30001,30002,30003,30004]);
// marketable();
