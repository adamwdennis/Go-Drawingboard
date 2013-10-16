var godrawingboard = (function() {
  var ASYNC_URL = 'https://cdnjs.cloudflare.com/ajax/libs/async/0.2.7/async.min.js';
  var GO_DRAWINGBOARD_APP = 'https://goinstant.net/GoDrawingBoard.JS/GoDrawingBoard.JS';

  var SCRIPT_URLS = [
    ['https://cdn.goinstant.net/v1/platform.min.js', 'goinstant'],  //PLATFORM
    ['https://cdn.goinstant.net/widgets/user-list/latest/user-list.min.js', 'goinstant.widgets.UserList'],  // USER_LIST
    ['https://cdn.goinstant.net/widgets/click-indicator/latest/click-indicator.min.js', 'goinstant.widgets.ClickIndicator'],  // CLICK_INDICATOR
    ['https://cdn.goinstant.net/widgets/user-colors/latest/user-colors.min.js', 'goinstant.widgets.UserColors'],  // USER_COLORS
    ['https://cdn.goinstant.net/widgets/notifications/latest/notifications.min.js', 'goinstant.widgets.Notifications']  // NOTIFICATIONS
  ];

  var CSS_URLS = [
    'https://cdn.goinstant.net/widgets/user-list/latest/user-list.css',
    'https://cdn.goinstant.net/widgets/click-indicator/latest/click-indicator.css',
    'https://cdn.goinstant.net/widgets/notifications/latest/notifications.css'
  ];

  var ORIGIN_GO_DRAWINGBOARD = 'godrawingboard';
  var GO_DRAWINGBOARD_ID = 'go_drawingboard_room';
  var GO_DRAWINGBOARD_USER_NAME = 'go_drawingboard_user_name';
  var QUERY_REGEX = new RegExp('\\?(.*)\\b' + GO_DRAWINGBOARD_ID + '=([^&#\/]*)(.*)');

  var roomName;
  var userName;
  var alreadyLoaded;
  var drawingboardRoom;
  var slide;
  var query;

  function connectToPlatform(cb) {
    var platform = new goinstant.Platform(GO_DRAWINGBOARD_APP);
    var notifications;

    async.series([
      // connect to GoInstant platform
      platform.connect.bind(platform),

      // create (if needed) the room instance for the drawingboard and
      // join the room and gain access to the drawingboard stat information
      function(next) {
        drawingboardRoom = platform.room(roomName);
        drawingboardRoom.join(next);
      },

      // subscribe to any notifications in the presentaiton room.
      function(next) {
        notifications = new goinstant.widgets.Notifications();
        notifications.subscribe(drawingboardRoom, next);
      },

      // set up the user's display name
      function(next) {
        drawingboardRoom.user(function(err, user, userKey) {
          if (err) {
            return next(err);
          }

          var displayNameKey = userKey.key('displayName');
          displayNameKey.set(userName, function(err) {
            if (err) {
              return next(err);
            }

            if (alreadyLoaded) {
              return next();
            }

            var publishOpts = {
              room: drawingboardRoom,
              type: 'success',
              message: userName + ' has joined.'
            };

            // publish a notification of the new user
            notifications.publish(publishOpts, next);
          });
        });
      },

      // select a colour for the current user
      function(next) {
        var opts = {
          room: drawingboardRoom
        };

        var userColors = new goinstant.widgets.UserColors(opts);
        userColors.choose(next);
      },

      // initialize the user list
      function(next) {
        var opts = {
          room: drawingboardRoom,
          position: 'right'
        };

        var userList = new goinstant.widgets.UserList(opts);
        userList.initialize(next);
      },

      // initialize the clicking indicator
      function(next) {
        var opts = {
          room: drawingboardRoom
        };

        var clickIndicator = new goinstant.widgets.ClickIndicator(opts);
        clickIndicator.initialize(next);
      },

      function(next) {
        drawingboardRoom.user(function(err, userObj, userKeyObj) {
          if (err) {
            throw err;
          }
          var defaultBoard = new DrawingBoard.Board('default-board', {
            goinstant: {
              room: drawingboardRoom,
              userKey: userKeyObj
            }
          });
        });
        next();
      },

      // initialize the sharing of the state of the drawingboard.
      initializeSharing
    ], cb);
  }

  function initializeSharing() {

    // We are interested in knowing if there is a new query on the URL when the
    // slide show is loaded. This detects the use of the query parameter in the
    // default slide deck to change the transitions and themes.
    var parser = document.createElement('a');
    parser.href = window.location.toString();

    // Create the sharing URL by adding the roomName as a query parameter to
    // the current window.location.
    if (parser.search) {
      parser.search += '&' + GO_DRAWINGBOARD_ID + '=' + roomName;
    } else {
      parser.search = '?' + GO_DRAWINGBOARD_ID + '=' + roomName;
    }

    // Create Share Button
    addShareButton(parser.href);
  }

  function addShareButton(text) {
    var shareBtn = document.createElement('div');
    var cssBtn = 'display: block; position: fixed; bottom: 1em; left: 0; ' +
      'z-index: 9999; height: 17px; padding: 9px; font-size: 15px; ' +
      'font-family: sans-serif; font-weight: bold; background: white; ' +
      'border-radius: 0 3px 3px 0; border: 1px solid #ccc; ' +
      'text-decoration: none; color: #15A815;';
    var cssURL = 'font-weight: regular;';

    shareBtn.innerHTML = 'Share';
    shareBtn.style.cssText = cssBtn;

    var board = document.getElementsByClassName('board')[0];
    board.parentNode.insertBefore(shareBtn, board);

    shareBtn.onmouseover = function() {
      if (this.poppedOut) {
        return;
      }
      this.poppedOut = true;

      this.innerHTML +=
        '<input id="gi-share-text" type="text" value="' + text +
        '" style="margin: -5px 0 0 15px; padding: 5px; width: 180px;"/>';

      this.style.width = '250px';
      document.getElementById('gi-share-text').select();
    };

    shareBtn.onmouseout = function(evt) {
      if (evt.relatedTarget && evt.relatedTarget.id === 'gi-share-text') {
        return;
      }
      this.poppedOut = false;

      this.innerHTML = 'Share';
      this.style.width = 'auto';
    };
  }

  function setRoomName() {
    // if we have the go-drawingboard room in sessionStorage then just connect to
    // the room and continue with the initialization.
    roomName = sessionStorage.getItem(GO_DRAWINGBOARD_ID);
    if (roomName) {
      return true;
    }

    // if we do not have the name in storage then check to see if the window
    // location contains a query string containing the id of the room.

    // creating an anchor tag and assigning the href to the window location
    // will automatically parse out the URL components ... sweet.
    var parser = document.createElement('a');
    parser.href = window.location.toString();

    var hasRoom = QUERY_REGEX.exec(parser.search);
    var roomId = hasRoom && hasRoom[2];
    if (roomId) {
      roomName = roomId.toString();
      // add the cookie to the document.
      sessionStorage.setItem(GO_DRAWINGBOARD_ID, roomName);

      // regenerate the URI without the go-drawingboard query parameter and reload
      // the page with the new URI.
      var beforeRoom = hasRoom[1];
      if (beforeRoom[beforeRoom.length - 1] === '&') {
        beforeRoom = beforeRoom.slice(0, beforeRoom.lengh - 1);
      }
      var searchStr = beforeRoom + hasRoom[3];
      if (searchStr.length > 0) {
        searchStr = '?' + searchStr;
      }

      parser.search = searchStr;

      // set the new location and discontinue the initialization.
      window.location = parser.href;
      return false;
    }

    // there is no room to join for this drawingboard so simply create a new
    // room and set the cookie in case of future refreshes.
    var id = Math.floor(Math.random() * Math.pow(2, 32));
    roomName = id.toString();
    sessionStorage.setItem(GO_DRAWINGBOARD_ID, roomName);

    return true;
  }

  function loadResources(cb) {
    function _loadResource(type, url, testProperty, loaded) {
      // if the object exists then just return, no need to reload.
      if (window[testProperty]) {
        return loaded();
      }

      // Adding the script tag to the head as suggested before
      var res = document.createElement(type);
      if (type === 'script') {
        res.src = url;
        res.type = 'text/javascript';
      } else {
        res.rel = 'stylesheet';
        res.type = 'text/css';
        res.href = url;
      }

      // callbacks for loaded notification
      function _handleLoadEvent() {
        return loaded();
      }
      res.onreadystatechange = _handleLoadEvent;
      res.onload = _handleLoadEvent;

      // Fire the loading
      var head = document.getElementsByTagName('head')[0];
      head.appendChild(res);
    }

    // get async if it does not already exist.
    _loadResource('script', ASYNC_URL, 'async', function() {

      // Load all the resources in the array. Create the array of resoures
      // to load and then load each.
      var loadRequests = [];
      async.series([
        // add function calls to load all scripts to the load requests array
        function(next) {
          async.each(SCRIPT_URLS, function(params, cont) {
            loadRequests.push(_loadResource.bind(null, 'script', params[0], params[1]));
            return cont();
          }, next);
        },

        // add function calls to load all css to the load requests array
        function(next) {
          async.each(CSS_URLS, function(url, cont) {
            loadRequests.push(_loadResource.bind(null, 'link', url, null));
            return cont();
          }, next);
        },

        async.series.bind(async, loadRequests)
      ], cb);
    });
  }

  function getUserName() {
    userName = sessionStorage.getItem(GO_DRAWINGBOARD_USER_NAME);
    if (userName) {
      alreadyLoaded = true;
      return;
    }

    userName = prompt('What is your name?', 'Guest');
    if (!userName) {
      userName = 'Guest';
    }
    sessionStorage.setItem(GO_DRAWINGBOARD_USER_NAME, userName);

    return;
  }

  function initialize() {
    // we might have to reload if the we are passed a room name so do not
    // load the rest of the resources if the page is being reloaded.
    if (setRoomName()) {
      // get the display name from the user.
      getUserName();

      loadResources(function() {

        // set up listeners on the drawingboard
        //addListeners();

        // set up sharing and components.
        connectToPlatform();
      });
    }
  }

  return {
    initialize: initialize
  };
})();

godrawingboard.initialize();
