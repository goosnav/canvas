import { SIZE } from './board.js';

export function createNavigator(bitmap, { centerOn, zoomTo, invalidate }) {
  const details = document.querySelector('#map-details');
  const map = document.querySelector('#map');
  const thumbnail = document.querySelector('#thumbnail');
  const preview = thumbnail.getContext('2d');
  const box = document.querySelector('#viewport-box');
  const slider = document.querySelector('#zoom-slider');
  const output = document.querySelector('#zoom-value');
  const clamp = value => Math.max(0, Math.min(1, value));
  let view;
  let drag = null;
  let lastRevision = -1;

  details.open = !matchMedia('(max-width: 570px)').matches;
  details.addEventListener('toggle', invalidate);
  slider.oninput = () => zoomTo(view.minimum * (64 / view.minimum) ** (Number(slider.value) / 1000));

  function position(event) {
    const rect = map.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * SIZE / rect.width,
      y: (event.clientY - rect.top) * SIZE / rect.height
    };
  }

  function move(event) {
    const p = position(event);
    centerOn(p.x + drag.dx, p.y + drag.dy);
  }

  map.onpointerdown = event => {
    if (event.button !== 0 || drag || !view) return;
    event.preventDefault();
    map.focus({ preventScroll: true });
    const p = position(event);
    const inside = Math.abs(p.x - view.x) <= view.width / 2 && Math.abs(p.y - view.y) <= view.height / 2;
    drag = { id: event.pointerId, dx: inside ? view.x - p.x : 0, dy: inside ? view.y - p.y : 0 };
    map.setPointerCapture(event.pointerId);
    move(event);
  };
  map.onpointermove = event => { if (drag?.id === event.pointerId) move(event); };
  map.onpointerup = map.onpointercancel = map.onlostpointercapture = event => {
    if (drag?.id === event.pointerId) drag = null;
  };
  map.onkeydown = event => {
    const shifts = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const shift = shifts[event.key];
    if (!shift || !view) return;
    event.preventDefault();
    centerOn(view.x + shift[0] * view.width / 10, view.y + shift[1] * view.height / 10);
  };

  return function update(next, revision) {
    view = next;
    const percent = Math.round(view.scale * 100) + '%';
    output.textContent = percent;
    slider.value = 1000 * Math.log(view.scale / view.minimum) / Math.log(64 / view.minimum);
    slider.setAttribute('aria-valuetext', percent);
    if (!details.open) return;
    if (lastRevision !== revision) {
      preview.drawImage(bitmap, 0, 0, thumbnail.width, thumbnail.height);
      lastRevision = revision;
    }
    const left = clamp((view.x - view.width / 2) / SIZE);
    const top = clamp((view.y - view.height / 2) / SIZE);
    const right = clamp((view.x + view.width / 2) / SIZE);
    const bottom = clamp((view.y + view.height / 2) / SIZE);
    box.style.left = left * 100 + '%';
    box.style.top = top * 100 + '%';
    box.style.width = (right - left) * 100 + '%';
    box.style.height = (bottom - top) * 100 + '%';
  };
}
