export const photoCategories = [
  {
    slug: 'street',
    title: 'Street',
    directory: 'street',
    note: 'Unplanned gestures and everyday light.',
    rowLayout: true,
  },
  {
    slug: 'portrait',
    title: 'Portrait',
    directory: 'portrait',
    note: 'Faces, presence, and quiet exchange.',
    rowLayout: true,
  },
  {
    slug: 'scenes',
    title: 'Scenes',
    directory: 'scenes',
    note: 'Rooms, objects, architecture, and traces of place.',
    rowLayout: true,
  },
  {
    slug: 'nature',
    title: 'Nature',
    directory: 'nature',
    note: 'Sea, mountains, water, weather, and the natural world.',
    rowLayout: true,
  },
];

export const photoCategorySlugs = photoCategories.map((category) => category.slug);

export function getPhotoCategory(slug) {
  return photoCategories.find((category) => category.slug === slug);
}
