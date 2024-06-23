const { ls } = require('./storage');
const { socket } = require('./socket');
const { modal } = require('./modal');
const { place } = require('./place');
const { uiHelper } = require('./uiHelper');
const { lookup } = require('./lookup');
const { ban } = require('./ban');
const { chat } = require('./chat');

const { analytics } = require('./helpers');

// this holds user stuff / info
const user = (function() {
  const self = {
    instaban: false,
    elements: {
      users: $('#online-count'),
      userInfo: $('#user-info'),
      pixelCounts: $('#pixel-counts'),
      loginOverlay: $('#login-overlay'),
      signInWith: $('#sign-in-with'),
      legal: $('#legal'),
      userMessage: $('#user-message'),
      prompt: $('#prompt'),
      signup: $('#signup')
    },
    roles: [],
    pendingSignupToken: null,
    loggedIn: false,
    username: '',
    placementOverrides: null,
    getRoles: () => self.roles,
    isStaff: () => self.hasPermission('user.admin'),
    isDonator: () => self.hasPermission('user.donator'),
    getPermissions: () => {
      let perms = [];
      self.roles.flatMap(function loop(node) {
        if (node.inherits.length > 0) {
          perms.push(...node.permissions);
          return node.inherits.flatMap(loop);
        } else {
          perms.push(node.permissions);
        }
      });
      // NOTE: Slightly hacky fix for arrays showing up in permissions
      perms = perms.flatMap(permissions => permissions);
      return [...new Set(perms)];
    },
    hasPermission: node => self.getPermissions().includes(node),
    getUsername: () => self.username,
    getPixelCount: () => self.pixelCount,
    getPixelCountAllTime: () => self.pixelCountAllTime,
    signin: function() {
      const data = ls.get('auth_respond');
      if (!data) {
        return;
      }
      ls.remove('auth_respond');
      if (data.signup) {
        self.pendingSignupToken = data.token;
        self.elements.signup.fadeIn(200);
      } else {
        socket.reconnectSocket();
      }
      self.elements.prompt.fadeOut(200);
    },
    isLoggedIn: function() {
      return self.loggedIn;
    },
    webinit: function(data) {
      if (data.legal.termsUrl) {
        self.elements.legal.html(__('By logging in or registering, you agree to the <a href="{0}" target="_blank">terms of use</a> and <a href="{1}" target="_blank">privacy policy</a>.')
          .replace('{0}', data.legal.termsUrl)
          .replace('{1}', data.legal.privacyUrl));
      }

      const signInPromptLink = self.elements.signInWith.find('a');

      const authServices = Object.values(data.authServices);
      if (authServices.length === 1) {
        const service = authServices[0];
        signInPromptLink.text(__('Sign in with {0}').replace('{0}', service.name));
        signInPromptLink.attr('href', `/signin/${service.id}?redirect=1`);
        signInPromptLink.click(function(evt) {
          if (window.open(`/signin/${service.id}?redirect=1`, '_blank')) {
            evt.preventDefault();
            return;
          }
          ls.set('auth_same_window', true);
        });
        return;
      }

      signInPromptLink.click(function(evt) {
        evt.preventDefault();

        const cancelButton = crel('button', { class: 'float-right text-button' }, __('Cancel'));
        cancelButton.addEventListener('click', function() {
          self.elements.prompt.fadeOut(200);
        });

        self.elements.prompt[0].innerHTML = '';
        crel(self.elements.prompt[0],
          crel('div', { class: 'content' },
            crel('h1', __('Sign in with...')),
            crel('ul',
              Object.values(data.authServices).map(service => {
                const anchor = crel('a', { href: `/signin/${service.id}?redirect=1` }, service.name);
                anchor.addEventListener('click', function(e) {
                  if (window.open(this.href, '_blank')) {
                    e.preventDefault();
                    return;
                  }
                  ls.set('auth_same_window', true);
                });
                const toRet = crel('li', anchor);
                if (!service.registrationEnabled) {
                  crel(toRet, crel('span', { style: 'font-style: italic; font-size: .75em; font-weight: bold; color: red; margin-left: .5em' }, __('New Accounts Disabled')));
                }
                return toRet;
              })
            )
          ),
          cancelButton
        );
        self.elements.prompt.fadeIn(200);
      });
    },
    wsinit: function() {
      if (ls.get('auth_proceed')) {
        // we need to authenticate...
        ls.remove('auth_proceed');
        self.signin();
      }
    },
    doSignup: function() {
      if (!self.pendingSignupToken) return;

      $.post({
        type: 'POST',
        url: '/signup',
        data: {
          token: self.pendingSignupToken,
          username: self.elements.signup.find('#signup-username-input').val(),
          discord: self.elements.signup.find('#signup-discord-input').val()
        },
        success: function() {
          self.elements.signup.find('#error').text('');
          self.elements.signup.find('#signup-username-input').val('');
          self.elements.signup.find('#signup-discord-input').val('');
          self.elements.signup.fadeOut(200);
          socket.reconnectSocket();
          self.pendingSignupToken = null;
        },
        error: function(data) {
          self.elements.signup.find('#error').text(data.responseJSON.message);
        }
      });
      // self.pendingSignupToken = null;
    },
    doSignOut: function() {
      return fetch('/logout').then(() => {
        self.elements.userInfo.fadeOut(200);
        self.elements.pixelCounts.fadeOut(200);
        self.elements.userMessage.fadeOut(200);
        self.elements.loginOverlay.fadeIn(200);
        if (window.deInitAdmin) {
          window.deInitAdmin();
        }
        self.loggedIn = false;
        $(window).trigger('pxls:user:loginState', [false]);
        socket.reconnectSocket();
      });
    },
    init: function(instaban) {
      self.instaban = instaban;
      self.elements.userMessage.hide();
      self.elements.signup.hide();
      self.elements.signup.find('input').keydown(function(evt) {
        evt.stopPropagation();
        if (evt.key === 'Enter' || evt.which === 13) {
          self.doSignup();
        }
      });
      self.elements.signup.find('#signup-button').click(self.doSignup);
      $.get('/users', data => {
        self.elements.users.text(data.count + ' ' + __('online')).fadeIn(200);
      }).fail(function(e) {
        console.error('Error fetching /users: ', e);
        self.elements.users.hide();
      });
      self.elements.pixelCounts.hide();
      self.elements.userInfo.hide();
      self.elements.userInfo.find('.logout').click(function(evt) {
        evt.preventDefault();

        modal.show(modal.buildDom(
          crel('h2', { class: 'modal-title' }, __('Sign Out')),
          crel('div',
            crel('p', __('Are you sure you want to sign out?')),
            crel('div', { class: 'buttons' },
              crel('button', {
                class: 'dangerous-button text-button',
                onclick: () => self.doSignOut().then(() => modal.closeAll())
              }, __('Yes')),
              crel('button', {
                class: 'text-button',
                onclick: () => modal.closeAll()
              }, __('No'))
            )
          )
        ));
      });
      $(window).bind('storage', function(evt) {
        if (evt.originalEvent.key === 'auth') {
          ls.remove('auth');
          self.signin();
        }
      });
      socket.on('users', function(data) {
        self.elements.users.text(data.count + ' ' + __('online'));
      });
      socket.on('userinfo', function(data) {
        let isBanned = false;
        const banelem = crel('div', { class: 'ban-alert-content' });
        self.username = data.username;
        self.loggedIn = true;
        self.pixelCount = data.pixelCount;
        self.pixelCountAllTime = data.pixelCountAllTime;
        self.updatePixelCountElements();
        self.elements.pixelCounts.fadeIn(200);
        self.placementOverrides = data.placementOverrides;
        place.togglePaletteSpecialColors(data.placementOverrides.canPlaceAnyColor);
        self.roles = data.roles;
        $(window).trigger('pxls:user:loginState', [true]);
        self.renameRequested = data.renameRequested;
        uiHelper.setDiscordName(data.discordName || null);
        self.elements.loginOverlay.fadeOut(200);
        self.elements.userInfo.find('span#username').html(crel('a', {
          href: `/profile/${data.username}`,
          target: '_blank',
          title: __('My Profile')
        }, data.username).outerHTML);
        if (data.method === 'ip') {
          self.elements.userInfo.hide();
        } else {
          self.elements.userInfo.fadeIn(200);
        }

        if (data.banExpiry === 0) {
          isBanned = true;
          crel(banelem, crel('p', __('You are permanently banned.')));
        } else if (data.banned === true) {
          isBanned = true;
          const timestamp = new Date(data.banExpiry).toLocaleString();
          crel(banelem, crel('p', __(`You are temporarily banned and will not be allowed to place until ${timestamp}`)));
        } else if (self.isStaff()) {
          if (window.deInitAdmin) {
            window.deInitAdmin();
          }

          let scriptName = 'admin';

          const langcode = document.documentElement.lang;
          if (langcode !== 'en') {
            scriptName += '_' + langcode;
          }

          $.getScript(`admin/${scriptName}.js`).done(function() {
            window.initAdmin({
              socket: socket,
              user: user,
              modal: modal,
              lookup: lookup,
              chat: chat
            }, admin => { self.admin = admin; });
          });
        } else if (window.deInitAdmin) {
          window.deInitAdmin();
        }
        if (isBanned) {
          self.elements.userMessage.empty().show().text(__('You are banned. You can get an appeal link in the popup on refresh.')).fadeIn(200);
          crel(banelem,
            crel('p', __('If you think this was an error, please '), crel('a', { href: 'https://sinder.pxls.world/appeal', target: '_blank' }, 'appeal here'), crel('span', '.')),
            crel('p', __('Ban reason:')),
            crel('p', data.banReason)
          );
          modal.show(modal.buildDom(
            crel('h2', __('Banned')),
            banelem
          ), { escapeClose: false, clickClose: false });
          if (window.deInitAdmin) {
            window.deInitAdmin();
          }
        } else if (data.renameRequested) {
          self.showRenameRequest();
        } else {
          self.elements.userMessage.hide();
        }

        if (self.instaban) ban.shadow('App existed beforehand');

        analytics('send', 'event', 'Auth', 'Login', data.method);
      });
      socket.on('pixelCounts', function(data) {
        self.pixelCount = data.pixelCount;
        self.pixelCountAllTime = data.pixelCountAllTime;

        self.updatePixelCountElements();

        // For userscripts.
        $(window).trigger('pxls:pixelCounts:update', Object.assign({}, data));
      });
      socket.on('admin_placement_overrides', function(data) {
        self.placementOverrides = data.placementOverrides;
      });
      socket.on('rename', function(e) {
        if (e.requested === true) {
          self.showRenameRequest();
        } else {
          self.hideRenameRequest();
        }
      });
      socket.on('rename_success', e => {
        self.username = e.newName;
        self.elements.userInfo.find('span.name').text(e.newName);
      });
    },
    _handleRenameSubmit: function(event) {
      event.preventDefault();
      const input = this.querySelector('.rename-input');
      const btn = this.querySelector('.rename-submit');
      const err = this.querySelector('.rename-error');
      if (!input || !input.value || !btn || !err) return console.error('Missing one or more variables from querySelector. input: %o, btn: %o, err: %o', input, btn, err);
      input.disabled = btn.disabled = true;
      $.post('/execNameChange', { newName: input.value.trim() }, function() {
        self.renameRequested = false;
        self.hideRenameRequest();
        modal.closeAll();
      }).fail(function(xhrObj) {
        let resp = __('An unknown error occurred. Please contact staff on discord');
        if (xhrObj.responseJSON) {
          resp = xhrObj.responseJSON.details || resp;
        } else if (xhrObj.responseText) {
          try {
            resp = JSON.parse(xhrObj.responseText).details;
          } catch (ignored) {
          }
        }
        err.style.display = null;
        err.innerHTML = resp;
      }).always(function() {
        input.disabled = btn.disabled = false;
      });
    },
    _handleRenameClick: function(event) {
      const renamePopup = crel('form', { onsubmit: self._handleRenameSubmit },
        crel('p', __('Staff have required you to change your username, this usually means your name breaks one of our rules.')),
        crel('p', __('If you disagree, please contact us on Discord (link in the info panel).')),
        crel('label', __('New Username:') + ' ',
          crel('input', {
            type: 'text',
            class: 'rename-input',
            required: 'true',
            onkeydown: e => e.stopPropagation()
          })
        ),
        crel('p', {
          style: 'display: none; font-weight: bold; color: #f00; font-size: .9rem;',
          class: 'rename-error'
        }, ''),
        crel('div', { style: 'text-align: right' },
          crel('button', { class: 'text-button', onclick: () => modal.closeAll() }, __('Not now')),
          crel('button', { class: 'rename-submit text-button', type: 'submit' }, __('Change'))
        )
      );
      modal.show(modal.buildDom(
        crel('h2', { class: 'modal-title' }, __('Rename Requested')),
        renamePopup
      ));
    },
    showRenameRequest: () => {
      self.elements.userMessage.empty().show().append(
        crel('span', __('You must change your username.') + ' ',
          crel('span', {
            style: 'cursor: pointer; text-decoration: underline;',
            onclick: self._handleRenameClick
          }, __('Click here to continue.'))
        )
      ).fadeIn(200);
    },
    hideRenameRequest: () => {
      self.elements.userMessage.fadeOut(200);
    },
    updatePixelCountElements: () => {
      self.elements.pixelCounts.find('#current-pixel-count').text(self.pixelCount.toLocaleString());
    }
  };
  return {
    init: self.init,
    getRoles: self.getRoles,
    isStaff: self.isStaff,
    isDonator: self.isDonator,
    getPermissions: self.getPermissions,
    hasPermission: self.hasPermission,
    getUsername: self.getUsername,
    getPixelCount: self.getPixelCount,
    getPixelCountAllTime: self.getPixelCountAllTime,
    webinit: self.webinit,
    wsinit: self.wsinit,
    isLoggedIn: self.isLoggedIn,
    renameRequested: self.renameRequested,
    showRenameRequest: self.showRenameRequest,
    hideRenameRequest: self.hideRenameRequest,
    get admin() {
      return self.admin || false;
    },
    get placementOverrides() {
      return self.placementOverrides;
    }
  };
})();

module.exports.user = user;
