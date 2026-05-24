import React, { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { getUserLibraryApi } from '@jellyfin/sdk/lib/utils/api/user-library-api';
import { getTvShowsApi } from '@jellyfin/sdk/lib/utils/api/tv-shows-api';
import { useQuery } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';
import './MzDetailPage.scss';

// ============================================================
//  Image helpers
// ============================================================
function getBackdropUrl(item: BaseItemDto, basePath: string): string | null {
    const tag = item.BackdropImageTags?.[0];
    if (!tag || !item.Id) return null;
    return `${basePath}/Items/${item.Id}/Images/Backdrop/0?tag=${tag}&quality=85&maxWidth=1920`;
}

function getLogoUrl(item: BaseItemDto, basePath: string): string | null {
    const tag = item.ImageTags?.Logo;
    if (!tag || !item.Id) return null;
    return `${basePath}/Items/${item.Id}/Images/Logo?tag=${tag}&maxWidth=400`;
}

function getEpisodeThumbUrl(item: BaseItemDto, basePath: string): string | null {
    const thumbTag = item.ImageTags?.Primary;
    if (thumbTag && item.Id) return `${basePath}/Items/${item.Id}/Images/Primary?tag=${thumbTag}&fillWidth=320&quality=85`;
    const backdropTag = item.BackdropImageTags?.[0];
    if (backdropTag && item.Id) return `${basePath}/Items/${item.Id}/Images/Backdrop/0?tag=${backdropTag}&fillWidth=320&quality=85`;
    return null;
}

function formatRuntime(ticks: number): string {
    const mins = Math.round(ticks / 600_000_000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

// ============================================================
//  Episode Card
// ============================================================
interface EpCardProps {
    item: BaseItemDto;
    basePath: string;
    seriesId: string;
}

const EpisodeCard: React.FC<EpCardProps> = ({ item, basePath }) => {
    const thumb = getEpisodeThumbUrl(item, basePath);
    const href = item.Id && item.ServerId
        ? `#/video?id=${item.Id}&serverId=${item.ServerId}&mediaSourceId=${item.Id}`
        : undefined;
    const epNum = item.IndexNumber != null ? `Ep. ${item.IndexNumber}` : '';
    const progress = item.UserData?.PlayedPercentage;

    return (
        <a className='mz-ep-card' href={href}>
            <div className='mz-ep-card__thumb-wrap'>
                {thumb
                    ? <img className='mz-ep-card__thumb' src={thumb} alt='' loading='lazy' />
                    : <div className='mz-ep-card__thumb mz-ep-card__placeholder' />
                }
                {progress != null && progress > 0 && (
                    <div className='mz-ep-card__progress'>
                        <span className='mz-ep-card__progress-fill' style={{ width: `${progress}%` }} />
                    </div>
                )}
                <div className='mz-ep-card__play-overlay' aria-hidden='true'>
                    <svg viewBox='0 0 24 24' fill='currentColor'>
                        <polygon points='5 3 19 12 5 21 5 3' />
                    </svg>
                </div>
            </div>
            <div className='mz-ep-card__body'>
                <div className='mz-ep-card__num'>{epNum}</div>
                <div className='mz-ep-card__title'>{item.Name}</div>
                {item.RunTimeTicks && (
                    <div className='mz-ep-card__runtime'>{formatRuntime(item.RunTimeTicks)}</div>
                )}
                {item.Overview && (
                    <p className='mz-ep-card__desc'>{item.Overview}</p>
                )}
            </div>
        </a>
    );
};

// ============================================================
//  Detail Page
// ============================================================
const MzDetailPage: React.FC = () => {
    const [params] = useSearchParams();
    const itemId = params.get('id') ?? '';
    const { api, user } = useApi();
    const basePath = api?.basePath ?? '';

    const [seasonId, setSeasonId] = useState<string | null>(null);

    // Fetch item details
    const { data: item } = useQuery({
        queryKey: ['mz-detail', itemId],
        queryFn: async ({ signal }) => {
            if (!api || !user?.Id || !itemId) return null;
            const res = await getUserLibraryApi(api).getItem(
                { userId: user.Id, itemId },
                { signal }
            );
            return res.data ?? null;
        },
        enabled: !!api && !!user?.Id && !!itemId
    });

    // Fetch seasons (series only)
    const { data: seasons = [] } = useQuery({
        queryKey: ['mz-seasons', itemId],
        queryFn: async ({ signal }) => {
            if (!api || !user?.Id || !itemId) return [];
            const res = await getTvShowsApi(api).getSeasons(
                { seriesId: itemId, userId: user.Id },
                { signal }
            );
            return res.data?.Items ?? [];
        },
        enabled: !!api && !!user?.Id && !!itemId && item?.Type === 'Series'
    });

    // Pick default season once loaded
    const activeSeason = seasonId ?? seasons[0]?.Id ?? null;

    // Fetch episodes for active season
    const { data: episodes = [] } = useQuery({
        queryKey: ['mz-episodes', itemId, activeSeason],
        queryFn: async ({ signal }) => {
            if (!api || !user?.Id || !itemId || !activeSeason) return [];
            const res = await getTvShowsApi(api).getEpisodes(
                {
                    seriesId: itemId,
                    seasonId: activeSeason,
                    userId: user.Id,
                    fields: [ItemFields.Overview],
                    enableImageTypes: [ImageType.Primary, ImageType.Backdrop],
                    imageTypeLimit: 1
                },
                { signal }
            );
            return res.data?.Items ?? [];
        },
        enabled: !!api && !!user?.Id && !!itemId && !!activeSeason
    });

    const handleSeasonChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        setSeasonId(e.target.value);
    }, []);

    if (!item) return <div className='mz-detail-loading' />;

    const backdropUrl = getBackdropUrl(item, basePath);
    const logoUrl = getLogoUrl(item, basePath);
    const isSeries = item.Type === 'Series';

    // Build metadata chips
    const meta: { text: string; variant?: string }[] = [];
    if (item.OfficialRating) meta.push({ text: item.OfficialRating, variant: 'rating' });
    if (item.ProductionYear) meta.push({ text: String(item.ProductionYear) });
    if (isSeries && seasons.length > 0) meta.push({ text: `${seasons.length} temporada${seasons.length !== 1 ? 's' : ''}` });
    if (!isSeries && item.RunTimeTicks) meta.push({ text: formatRuntime(item.RunTimeTicks) });
    if (item.CommunityRating) meta.push({ text: `IMDb ${item.CommunityRating.toFixed(1)}`, variant: 'imdb' });
    if (item.Genres?.length) meta.push({ text: item.Genres.slice(0, 3).join(' · ') });

    const watchHref = item.Id && item.ServerId
        ? (isSeries && episodes[0]?.Id
            ? `#/video?id=${episodes[0].Id}&serverId=${item.ServerId}&mediaSourceId=${episodes[0].Id}`
            : `#/video?id=${item.Id}&serverId=${item.ServerId}&mediaSourceId=${item.Id}`)
        : undefined;

    return (
        <div className='mz-detail'>
            {/* Hero */}
            <section className='mz-detail-hero'>
                <div
                    className='mz-detail-hero__bg'
                    style={backdropUrl ? { backgroundImage: `url('${backdropUrl}')` } : {}}
                />
                <div className='mz-detail-hero__overlay' />

                <div className='mz-detail-hero__content'>
                    <div className='mz-detail-hero__kicker'>
                        {isSeries ? 'SÉRIE' : 'FILME'}
                    </div>

                    {logoUrl ? (
                        <img className='mz-detail-hero__logo' src={logoUrl} alt={item.Name ?? ''} />
                    ) : (
                        <h1 className='mz-detail-hero__title'>{item.Name}</h1>
                    )}

                    {meta.length > 0 && (
                        <div className='mz-detail-hero__meta'>
                            {meta.map((m, i) => (
                                <React.Fragment key={i}>
                                    {i > 0 && !m.variant && <span className='mz-hero__dot-sep'>·</span>}
                                    {m.variant
                                        ? <span className={`mz-detail-hero__badge mz-detail-hero__badge--${m.variant}`}>{m.text}</span>
                                        : <span>{m.text}</span>
                                    }
                                </React.Fragment>
                            ))}
                        </div>
                    )}

                    {item.Overview && (
                        <p className='mz-detail-hero__desc'>{item.Overview}</p>
                    )}

                    <div className='mz-detail-hero__cta'>
                        <a className='mz-btn mz-btn--primary' href={watchHref}>
                            <svg viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
                                <polygon points='5 3 19 12 5 21 5 3' />
                            </svg>
                            Assistir Ep. 1
                        </a>
                    </div>
                </div>
            </section>

            {/* Episodes (series only) */}
            {isSeries && (
                <section className='mz-detail-eps'>
                    <div className='mz-detail-eps__head'>
                        <h2 className='mz-detail-eps__title'>Episódios</h2>
                        {seasons.length > 1 && (
                            <select
                                className='mz-detail-eps__season-select'
                                value={activeSeason ?? ''}
                                onChange={handleSeasonChange}
                            >
                                {seasons.map(s => (
                                    <option key={s.Id} value={s.Id ?? ''}>{s.Name}</option>
                                ))}
                            </select>
                        )}
                    </div>

                    <div className='mz-detail-eps__grid'>
                        {episodes.map(ep => (
                            <EpisodeCard
                                key={ep.Id}
                                item={ep}
                                basePath={basePath}
                                seriesId={itemId}
                            />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
};

export default MzDetailPage;
