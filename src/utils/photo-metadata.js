const NUMBER_TITLE = /^No\.\s*\d+$/i;

export function cleanPhotoText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getPhotoTitle(photo) {
  const title = cleanPhotoText(photo?.title);
  return NUMBER_TITLE.test(title) ? '' : title;
}

export function getPhotoCaption(photo) {
  return cleanPhotoText(photo?.captionText ?? photo?.homeCaption);
}

export function getPhotoLocation(photo) {
  return cleanPhotoText(photo?.location);
}

export function getPhotoDate(photo) {
  return cleanPhotoText(photo?.date);
}

export function getPhotoMeta(photo) {
  return {
    title: getPhotoTitle(photo),
    captionText: getPhotoCaption(photo),
    location: getPhotoLocation(photo),
    date: getPhotoDate(photo),
  };
}
