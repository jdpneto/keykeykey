navigator.clipboard
  .writeText('')
  .then(() => {
    window.close();
  })
  .catch(() => {
    window.close();
  });
