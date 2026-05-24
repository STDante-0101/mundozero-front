import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';

export function itemHref(item: BaseItemDto): string | undefined {
    if (!item.Id || !item.ServerId) return undefined;
    const base = item.Type === 'Series'
        ? `#/series?id=${item.Id}&serverId=${item.ServerId}`
        : `#/details?id=${item.Id}&serverId=${item.ServerId}`;
    return base;
}
