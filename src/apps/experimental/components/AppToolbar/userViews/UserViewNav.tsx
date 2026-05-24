import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import ArrowDropDown from '@mui/icons-material/ArrowDropDown';
import Favorite from '@mui/icons-material/Favorite';
import Button from '@mui/material/Button/Button';
import Icon from '@mui/material/Icon';
import React, { useCallback, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';

import { MetaView } from 'apps/experimental/constants/metaView';
import { useAncestors } from 'apps/experimental/features/libraries/hooks/api/useAncestors';
import { isDetailsPath, isLibraryPath } from 'apps/experimental/features/libraries/utils/path';
import { useUserViews } from 'hooks/api/useUserViews';
import { useApi } from 'hooks/useApi';
import useCurrentTab from 'hooks/useCurrentTab';
import { useWebConfig } from 'hooks/useWebConfig';
import globalize from 'lib/globalize';

import UserViewsMenu from './UserViewsMenu';

const GENRE_MENU_ID = 'user-view-genre-menu';

const HOME_PATH = '/home';
const LIST_PATH = '/list';

const getCurrentUserView = (
    userViews: BaseItemDto[] | undefined,
    pathname: string,
    libraryId: string | null,
    collectionType: string | null,
    tab: number
) => {
    const isUserViewPath = isDetailsPath(pathname) || isLibraryPath(pathname) || [HOME_PATH, LIST_PATH].includes(pathname);
    if (!isUserViewPath) return undefined;

    if (collectionType === CollectionType.Livetv) {
        return userViews?.find(({ CollectionType: type }) => type === CollectionType.Livetv);
    }

    if (pathname === HOME_PATH && tab === 1) {
        return MetaView.Favorites;
    }

    // eslint-disable-next-line sonarjs/different-types-comparison
    return userViews?.find(({ Id: id }) => id === libraryId);
};

const UserViewNav = () => {
    const location = useLocation();
    const [ searchParams ] = useSearchParams();
    const itemId = searchParams.get('id') || undefined;
    const libraryId = searchParams.get('topParentId') || searchParams.get('parentId');
    const collectionType = searchParams.get('collectionType');
    const { activeTab } = useCurrentTab();
    const { menuLinks } = useWebConfig();

    const { user } = useApi();
    const {
        data: userViews,
        isPending
    } = useUserViews({ userId: user?.Id });

    const {
        data: ancestors
    } = useAncestors({ itemId });

    const ancestorLibraryId = useMemo(() => {
        return ancestors?.find(ancestor => ancestor.Type === BaseItemKind.CollectionFolder)?.Id || null;
    }, [ ancestors ]);

    const [ genreAnchorEl, setGenreAnchorEl ] = useState<null | HTMLElement>(null);
    const isGenreMenuOpen = Boolean(genreAnchorEl);

    const onGenreButtonClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
        setGenreAnchorEl(event.currentTarget);
    }, []);

    const onGenreMenuClose = useCallback(() => {
        setGenreAnchorEl(null);
    }, []);

    const currentUserView = useMemo(() => (
        getCurrentUserView(userViews?.Items, location.pathname, libraryId || ancestorLibraryId, collectionType, activeTab)
    ), [ activeTab, collectionType, libraryId, ancestorLibraryId, location.pathname, userViews ]);

    const libraryItems = useMemo(() => userViews?.Items || [], [ userViews ]);

    // Is the current page inside one of the library (genre) items?
    const isGenreActive = useMemo(() => (
        currentUserView?.Id !== undefined
        && currentUserView.Id !== MetaView.Favorites.Id
        && libraryItems.some(v => v.Id === currentUserView.Id)
    ), [ currentUserView, libraryItems ]);

    if (isPending) return null;

    return (
        <>
            <Button
                variant='text'
                color={(currentUserView?.Id === MetaView.Favorites.Id) ? 'primary' : 'inherit'}
                startIcon={<Favorite />}
                component={Link}
                to='/home?tab=1'
            >
                {globalize.translate(MetaView.Favorites.Name)}
            </Button>

            {/* menuLinks rendered individually */}
            {(menuLinks || []).map(navItem => (
                <Button
                    key={navItem.name}
                    variant='text'
                    color='inherit'
                    startIcon={<Icon>{navItem.icon || 'link'}</Icon>}
                    component='a'
                    href={navItem.url}
                    target='_blank'
                    rel='noopener noreferrer'
                >
                    {navItem.name}
                </Button>
            ))}

            {/* All Jellyfin libraries grouped under a single "Gênero" dropdown */}
            {libraryItems.length > 0 && (
                <>
                    <Button
                        variant='text'
                        color={isGenreActive ? 'primary' : 'inherit'}
                        endIcon={<ArrowDropDown />}
                        aria-controls={GENRE_MENU_ID}
                        aria-haspopup='true'
                        onClick={onGenreButtonClick}
                    >
                        Gênero
                    </Button>

                    <UserViewsMenu
                        anchorEl={genreAnchorEl}
                        id={GENRE_MENU_ID}
                        open={isGenreMenuOpen}
                        onMenuClose={onGenreMenuClose}
                        userViews={libraryItems}
                        selectedId={currentUserView?.Id}
                    />
                </>
            )}
        </>
    );
};

export default UserViewNav;
