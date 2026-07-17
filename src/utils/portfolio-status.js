import { getSelectedPhotoIdSet, getSelectedPhotoIds } from '../data/portfolio-selection.js';

export const portfolioStatuses = Object.freeze(['selected', 'archive']);

export function isPortfolioCategory(category) {
  return ['street', 'portrait', 'scenes', 'nature'].includes(category);
}

export function getPortfolioStatus(photo, category = photo?.category) {
  if (!photo || !isPortfolioCategory(category)) return null;
  if (portfolioStatuses.includes(photo.portfolioStatus)) return photo.portfolioStatus;
  return getSelectedPhotoIdSet(category).has(photo.id) ? 'selected' : 'archive';
}

function numericOrder(photo, field, fallback) {
  const value = Number(photo?.[field]);
  if (Number.isFinite(value)) return value;
  const legacy = Number(photo?.order);
  return Number.isFinite(legacy) ? legacy : fallback;
}

export function sortPortfolioPhotos(photos = [], status) {
  return photos
    .map((photo, index) => ({
      photo,
      index,
      order: status ? numericOrder(photo, status === 'selected' ? 'selectedOrder' : 'archiveOrder', index + 1) : numericOrder(photo, 'order', index + 1),
    }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ photo }) => photo);
}

function legacySelectedOrder(category, items) {
  const source = getSelectedPhotoIds(category);
  const known = new Set(items.map((photo) => photo.id));
  return source.filter((id) => known.has(id));
}

/**
 * Adds portfolioStatus/selectedOrder/archiveOrder without changing image or
 * layout fields. Existing explicit statuses win; legacy files fall back to
 * the hand-curated selection list rather than an arbitrary slice of photos.
 */
export function migratePortfolioPhotos(photos = []) {
  const result = photos.map((photo) => ({ ...photo }));

  ['street', 'portrait', 'scenes', 'nature'].forEach((category) => {
    const items = result.filter((photo) => photo.category === category);
    if (!items.length) return;

    const selected = items.filter((photo) => getPortfolioStatus(photo, category) === 'selected');
    const archive = items.filter((photo) => getPortfolioStatus(photo, category) === 'archive');
    const hasExplicitStatus = items.some((photo) => portfolioStatuses.includes(photo.portfolioStatus));
    const selectedOrdered = hasExplicitStatus
      ? sortPortfolioPhotos(selected, 'selected')
      : legacySelectedOrder(category, items).map((id) => items.find((photo) => photo.id === id)).filter(Boolean);
    const selectedSet = new Set(selectedOrdered.map((photo) => photo.id));
    const archiveOrdered = hasExplicitStatus
      ? sortPortfolioPhotos(archive, 'archive')
      : sortPortfolioPhotos(items.filter((photo) => !selectedSet.has(photo.id)), null);

    selectedOrdered.forEach((photo, index) => {
      photo.portfolioStatus = 'selected';
      photo.selectedOrder = index + 1;
      photo.archiveOrder = null;
    });
    archiveOrdered.forEach((photo, index) => {
      photo.portfolioStatus = 'archive';
      photo.selectedOrder = null;
      photo.archiveOrder = index + 1;
    });
  });

  return result;
}

export function normalizePortfolioCategory(items, category) {
  const migrated = migratePortfolioPhotos(items);
  return {
    selected: sortPortfolioPhotos(migrated.filter((photo) => photo.category === category && getPortfolioStatus(photo, category) === 'selected'), 'selected'),
    archive: sortPortfolioPhotos(migrated.filter((photo) => photo.category === category && getPortfolioStatus(photo, category) === 'archive'), 'archive'),
  };
}
