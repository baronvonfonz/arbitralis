import createClient, { FetchOptions } from 'openapi-fetch';
import { UniversalisV2 } from 'universalis-ts';

const { get } = createClient<UniversalisV2.paths>({ baseUrl: 'https://universalis.app'});

type ItemsStatsType = UniversalisV2.components["schemas"]["HistoryMultiViewV2"]["items"];

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

async function historicalItemStatsInner(itemIds: number[], worldDcRegion = 40,): Promise<ItemsStatsType> {
    if (itemIds.length > 100) {
        throw Error('API allows only 100 items at a time');
    }
    console.log(`Querying for items [${itemIds[0]} ... ${itemIds[itemIds.length - 1]}]`);
    const results = await get('/api/v2/history/{worldDcRegion}/{itemIds}', {
        params: {
            query: {
                entriesToReturn: '5000',
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
        console.error(`Bad item IDs were passed: ${unresolvedItems}`);
    }

    return items    
}

// 40 is Jenova
async function historicalItemStats(itemIds: number[]) {
    console.log(`Attempting to query ${itemIds.length}, this will be appx ${Math.floor(itemIds.length / 100)} API calls`);
    const itemIdSublists: number[][] = [];
    for (let i = 0; i < itemIds.length; i += 100) {
        itemIdSublists.push(itemIds.slice(i, i + 100));
    }
    const responses: ItemsStatsType[] = [];
    for (let i = 0; i < itemIdSublists.length; i += 15) {
        const itemIdSublistIndices: number[] = [];
        for (let j = 0; j < 15; j++) {
            const nextIndex = j + i;
            if (nextIndex < itemIdSublists.length) {
                itemIdSublistIndices.push(nextIndex);
            }
        }
        (await Promise.all(
            itemIdSublistIndices.map(async (itemSublistIndex) => historicalItemStatsInner(itemIdSublists[itemSublistIndex]))
        )).forEach(result => responses.push(result));
        console.log('Waiting 3 seconds before next batch');
        await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    return responses.reduce((bigMap, subMap) => ({ ...bigMap, ...subMap }), {});
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

export { historicalItemStats, marketable };