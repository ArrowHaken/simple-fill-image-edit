// Keep the draft's select value as the single source of truth.
export function setupRangePicker() {
  const select = document.querySelector('#growthMode');
  const trigger = document.querySelector('#growthTrigger');
  const label = document.querySelector('#growthValue');
  const menu = document.createElement('div');
  menu.id = 'growthMenu';
  menu.className = 'range-menu';
  menu.setAttribute('popover', 'auto');
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-labelledby', 'growthLabel');
  const options = [...select.options].map(option => {
    const button = document.createElement('button');
    button.type = 'button';
    button.tabIndex = -1;
    button.setAttribute('role', 'option');
    button.dataset.value = option.value;
    button.textContent = option.textContent;
    menu.append(button);
    button.onclick = () => {
      const changed = select.value !== option.value;
      select.value = option.value;
      sync();
      close(true);
      if (changed) select.dispatchEvent(new Event('change', {bubbles:true}));
    };
    return button;
  });
  document.body.append(menu);
  const isOpen = () => menu.matches(':popover-open');
  function close(focus = false) {
    if (isOpen()) menu.hidePopover();
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus({preventScroll:true});
  }
  function sync() {
    label.textContent = select.selectedOptions[0].textContent;
    options.forEach(button => button.setAttribute('aria-selected', String(button.dataset.value === select.value)));
  }
  function open() {
    sync();
    const rect = trigger.getBoundingClientRect();
    menu.style.width = `${Math.min(rect.width, innerWidth - 16)}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - rect.width - 8))}px`;
    menu.style.maxHeight = `${Math.max(120, Math.max(innerHeight - rect.bottom, rect.top) - 16)}px`;
    menu.showPopover();
    const height = menu.getBoundingClientRect().height;
    menu.style.top = `${rect.bottom + height + 8 <= innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - height - 6)}px`;
    trigger.setAttribute('aria-expanded', 'true');
    options[select.selectedIndex].focus({preventScroll:true});
  }
  trigger.onclick = () => isOpen() ? close() : open();
  trigger.onkeydown = event => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(); }
  };
  menu.onkeydown = event => {
    const index = options.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = (index + 1) % options.length;
    if (event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = options.length - 1;
    if (next !== undefined) { event.preventDefault(); options[next].focus(); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    if (event.key === 'Tab') close(true);
  };
  menu.addEventListener('toggle', () => trigger.setAttribute('aria-expanded', String(isOpen())));
  window.addEventListener('resize', () => close());
  document.addEventListener('scroll', event => { if (!menu.contains(event.target)) close(); }, true);
  select.addEventListener('change', sync);
  sync();
  return () => { close(); sync(); };
}
