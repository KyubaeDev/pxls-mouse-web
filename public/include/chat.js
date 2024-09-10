const { settings } = require('./settings');
const { modal } = require('./modal');
let uiHelper;
let user;
let board;

const chat = (function() {
  const self = {
    markdownProcessor: null,
    init: async () => {
      uiHelper = require('./uiHelper').uiHelper;
      // NOTE(netux): The processor is deriverately left unfrozen to allow for extending
      // it through third party extensions.
      self.markdownProcessor = uiHelper.makeMarkdownProcessor()
        .use(function() {
          this.Compiler.prototype.visitors.link = (node, next) => {
            const url = new URL(node.url, location.href);

            const hashParams = new URLSearchParams(url.hash.substr(1));
            const getParam = (name) => hashParams.has(name) ? hashParams.get(name) : url.searchParams.get(name);

            const coordsX = parseFloat(getParam('x'));
            const coordsY = parseFloat(getParam('y'));

            const isSameOrigin = location.origin && url.origin && location.origin === url.origin;
            if (isSameOrigin && !isNaN(coordsX) && !isNaN(coordsY) && board.validateCoordinates(coordsX, coordsY)) {
              const scale = parseFloat(getParam('scale'));
              return self._makeCoordinatesElement(url.toString(), coordsX, coordsY, isNaN(scale) ? 20 : scale, getParam('template'), getParam('title'));
            } else {
              return self._makeLinkElement(node.url);
            }
          };

          this.Compiler.prototype.visitors.coordinate =
            (node, next) => self._makeCoordinatesElement(node.url, node.x, node.y, node.scale);
        });
    },
    processMessage: (str, mentionCallback) => {
      let content = str;
      try {
        const processor = self.markdownProcessor()
          .use(pxlsMarkdown.plugins.mention, { mentionCallback });
        const file = processor.processSync(str);
        content = file.result;
      } catch (err) {
        console.error(`could not process chat message "${str}"`, err, '\nDefaulting to raw content.');
      }

      return content;
    },
    _makeLinkElement: (href) => {
      function handleClick(e) {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          // open the link in a new window / tab
          return;
        }

        e.preventDefault();

        const skipLinkCheck = !self.defaultExternalLinkPopup || settings.chat.links.external.skip.get();
        if (skipLinkCheck) {
          window.open(href, '_blank');
        } else {
          self._popLinkCheck(href).then(action => {
            modal.closeAll();
            if (action) {
              window.open(href, '_blank');
            }
          });
        }
      }

      return crel('a', {
        class: 'link',
        href,
        onclick: handleClick
      }, href);
    },
    _popLinkCheck: (href) => {
      return new Promise((resolve, reject) => {
        const bodyWrapper = crel('div');
        const url = new URL(href);
        const baseDomain = url.hostname.replace(/^www\./, '');

        modal.show(modal.buildDom(
          crel('h2', __('External Link')),
          crel(bodyWrapper,
            { style: 'display: flex; flex-direction: column; gap: .75em; max-width: 35em;' },
            crel('span', __('This link is taking you to the following website:')),
            crel('code', { class: 'text-orange', style: 'overflow-wrap: break-word; word-wrap: break-word;' }, href),
            crel('span', __('The operators of this website have no responsibility or control over the contents hosted at {0}. Are you sure you want to go there?').replace('{0}', baseDomain)),
            crel('span', { class: 'text-muted' }, __('Note: You can disable this popup in settings.'))
          ),
          [
            [__('Cancel'), () => resolve(false)],
            [__('Visit Site'), () => resolve(true)]
          ].map(x =>
            crel('button', {
              class: 'text-button',
              style: 'margin-left: 3px; margin-bottom: 1em; position: initial !important; bottom: initial !important; right: initial !important;',
              onclick: x[1]
            }, x[0])
          )
        ));
      });
    },
    _makeCoordinatesElement: (raw, x, y, scale, template, title) => {
      let text = `(${x}, ${y}${scale != null ? `, ${scale}x` : ''})`;
      if (template != null && template.length >= 11) { // we have a template, should probably make that known
        let tmplName = settings.chat.links.templates.preferurls.get() !== true && title && title.trim() ? title : template;
        try {
          tmplName = decodeURIComponent(tmplName);
        } catch (e) {
          if (!(e instanceof URIError)) throw e;
        }
        if (tmplName.length > 25) {
          tmplName = `${tmplName.substr(0, 22)}...`;
        }
        text += ` (${__('template:')} ${tmplName})`;
      }

      function handleClick(e) {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          // open the link in a new window / tab
          return;
        }

        e.preventDefault();

        if (template) {
          const internalClickDefault = settings.chat.links.internal.behavior.get();
          if (internalClickDefault === self.TEMPLATE_ACTIONS.ASK.id) {
            self._popTemplateOverwriteConfirm(e.target).then(action => {
              modal.closeAll();
              self._handleTemplateOverwriteAction(action, e.target);
            });
          } else {
            self._handleTemplateOverwriteAction(internalClickDefault, e.target);
          }
        } else {
          self.jump(parseFloat(x), parseFloat(y), parseFloat(scale));
        }
      }

      return crel('a', {
        class: 'link coordinates',
        dataset: {
          raw,
          x,
          y,
          scale,
          template,
          title
        },
        href: raw,
        onclick: handleClick
      }, text);
    },
    _handleTemplateOverwriteAction: (action, linkElem) => {
      switch (action) {
        case false:
          break;
        case self.TEMPLATE_ACTIONS.CURRENT_TAB.id: {
          self._pushStateMaybe(); // ensure people can back button if available
          document.location.href = linkElem.dataset.raw; // overwrite href since that will trigger hash-based update of template. no need to re-write that logic
          break;
        }
        case self.TEMPLATE_ACTIONS.JUMP_ONLY.id: {
          self._pushStateMaybe(); // ensure people can back button if available
          self.jump(parseFloat(linkElem.dataset.x), parseFloat(linkElem.dataset.y), parseFloat(linkElem.dataset.scale));
          break;
        }
        case self.TEMPLATE_ACTIONS.NEW_TAB.id: {
          if (!window.open(linkElem.dataset.raw, '_blank')) { // what popup blocker still blocks _blank redirects? idk but i'm sure they exist.
            modal.show(modal.buildDom(
              crel('h2', { class: 'modal-title' }, __('Open Failed')),
              crel('div',
                crel('h3', __('Failed to automatically open in a new tab')),
                crel('a', {
                  href: linkElem.dataset.raw,
                  target: '_blank'
                }, __('Click here to open in a new tab instead'))
              )
            ));
          }
          break;
        }
      }
    },
    _popTemplateOverwriteConfirm: (internalJumpElem) => {
      return new Promise((resolve, reject) => {
        const bodyWrapper = crel('div');
        // const buttons = crel('div', { style: 'text-align: right; display: block; width: 100%;' });

        modal.show(modal.buildDom(
          crel('h2', { class: 'modal-title' }, __('Open Template')),
          crel(bodyWrapper,
            crel('h3', { class: 'text-orange' }, __('This link will overwrite your current template. What would you like to do?')),
            Object.values(self.TEMPLATE_ACTIONS).map(action => action.id === self.TEMPLATE_ACTIONS.ASK.id ? null
              : crel('label', { style: 'display: block; margin: 3px 3px 3px 1rem; margin-left: 1rem;' },
                crel('input', {
                  type: 'radio',
                  name: 'link-action-rb',
                  'data-action-id': action.id
                }),
                action.pretty
              )
            ),
            crel('span', { class: 'text-muted' }, __('Note: You can set a default action in the settings menu which bypasses this popup completely.'))
          ),
          [
            [__('Cancel'), () => resolve(false)],
            [__('OK'), () => resolve(bodyWrapper.querySelector('input[type=radio]:checked').dataset.actionId)]
          ].map(x =>
            crel('button', {
              class: 'text-button',
              style: 'margin-left: 3px; position: initial !important; bottom: initial !important; right: initial !important;',
              onclick: x[1]
            }, x[0])
          )
        ));
        bodyWrapper.querySelector(`input[type="radio"][data-action-id="${self.TEMPLATE_ACTIONS.NEW_TAB.id}"]`).checked = true;
      });
    },
    _pushStateMaybe(url) {
      if ((typeof history.pushState) === 'function') {
        history.pushState(null, document.title, url == null ? document.location.href : url); // ensure people can back button if available
      }
    },
    _handleActionClick: function(e) { // must be es5 for expected behavior. don't upgrade syntax, this is attached as an onclick and we need `this` to be bound by dom bubbles.
      if (!this.dataset) return console.trace('onClick attached to invalid object');

      const reportingTarget = this.dataset.target;

      $('.popup').remove();
      switch (this.dataset.action.toLowerCase().trim()) {
        case 'lookup-mod': {
          if (user.admin && user.admin.checkUser && user.admin.checkUser.check) {
            const type = board.snipMode ? 'cmid' : 'username';
            const arg = board.snipMode ? this.dataset.id : reportingTarget;
            user.admin.checkUser.check(arg, type);
          }
          break;
        }
        case 'request-rename': {
          const rbStateOn = crel('input', { type: 'radio', name: 'rbState' });
          const rbStateOff = crel('input', { type: 'radio', name: 'rbState' });

          const stateOn = crel('label', { style: 'display: inline-block' }, rbStateOn, ' ' + __('On'));
          const stateOff = crel('label', { style: 'display: inline-block' }, rbStateOff, ' ' + __('Off'));

          const btnSetState = crel('button', { class: 'text-button', type: 'submit' }, __('Set'));

          const renameError = crel('p', {
            style: 'display: none; color: #f00; font-weight: bold; font-size: .9rem',
            class: 'rename-error'
          }, '');

          rbStateOff.checked = true;

          const renameWrapper = crel('form', { class: 'chatmod-container' },
            crel('h3', __('Toggle Rename Request')),
            crel('p', __('Select one of the options below to set the current rename request state.')),
            crel('div', stateOn, stateOff),
            renameError,
            crel('div', { class: 'buttons' },
              crel('button', {
                class: 'text-button',
                type: 'button',
                onclick: () => {
                  renameWrapper.remove();
                  modal.closeAll();
                }
              }, __('Cancel')),
              btnSetState
            )
          );

          renameWrapper.onsubmit = e => {
            e.preventDefault();
            $.post('/admin/flagNameChange', {
              user: reportingTarget,
              flagState: rbStateOn.checked === true
            }, function() {
              renameWrapper.remove();
              modal.showText(__('Rename request updated'));
            }).fail(function(xhrObj) {
              let resp = __('An unknown error occurred. Please contact a developer');
              if (xhrObj.responseJSON) {
                resp = xhrObj.responseJSON.details || resp;
              } else if (xhrObj.responseText) {
                try {
                  resp = JSON.parse(xhrObj.responseText).details;
                } catch (ignored) {
                }
              }

              renameError.style.display = null;
              renameError.innerHTML = resp;
            });
          };
          modal.show(modal.buildDom(
            crel('h2', { class: 'modal-title' }, 'Request Rename'),
            renameWrapper
          ));
          break;
        }
        case 'force-rename': {
          const newNameInput = crel('input', {
            type: 'text',
            required: 'true',
            onkeydown: e => e.stopPropagation()
          });
          const newNameWrapper = crel('label', __('New Name: '), newNameInput);

          const btnSetState = crel('button', { class: 'text-button', type: 'submit' }, __('Set'));

          const renameError = crel('p', {
            style: 'display: none; color: #f00; font-weight: bold; font-size: .9rem',
            class: 'rename-error'
          }, '');

          const renameWrapper = crel('form', { class: 'chatmod-container' },
            crel('p', __('Enter the new name for the user below. Please note that if you\'re trying to change the caps, you\'ll have to rename to something else first.')),
            newNameWrapper,
            renameError,
            crel('div', { class: 'buttons' },
              crel('button', {
                class: 'text-button',
                type: 'button',
                onclick: () => {
                  modal.closeAll();
                }
              }, __('Cancel')),
              btnSetState
            )
          );

          renameWrapper.onsubmit = e => {
            e.preventDefault();
            $.post('/admin/forceNameChange', {
              user: reportingTarget,
              newName: newNameInput.value.trim()
            }, function() {
              modal.showText(__('User renamed'));
            }).fail(function(xhrObj) {
              let resp = __('An unknown error occurred. Please contact a developer');
              if (xhrObj.responseJSON) {
                resp = xhrObj.responseJSON.details || resp;
              } else if (xhrObj.responseText) {
                try {
                  resp = JSON.parse(xhrObj.responseText).details;
                } catch (ignored) {
                }
              }

              renameError.style.display = null;
              renameError.innerHTML = resp;
            });
          };
          modal.show(modal.buildDom(
            crel('h2', { class: 'modal-title' }, __('Force Rename')),
            renameWrapper
          ));
          break;
        }
        case 'profile': {
          if (!window.open(`/profile/${reportingTarget}`, '_blank')) {
            modal.show(modal.buildDom(
              crel('h2', { class: 'modal-title' }, __('Open Failed')),
              crel('div',
                crel('h3', __('Failed to automatically open in a new tab')),
                crel('a', {
                  href: `/profile/${reportingTarget}`,
                  target: '_blank'
                }, __('Click here to open in a new tab instead'))
              )
            ));
          }
          break;
        }
      }
    }
  };
  return {
    init: self.init,
    _handleActionClick: self._handleActionClick,
    processMessage: self.processMessage,
    registerHook: self.registerHook,
    replaceHook: self.replaceHook,
    unregisterHook: self.unregisterHook,
    runLookup: self.runLookup,
    get markdownProcessor() {
      return self.markdownProcessor;
    }
  };
})();

module.exports.chat = chat;
