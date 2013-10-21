/**
 * pass the id of the html element to put the drawing board into
 * and some options : {
 *	controls: array of controls to initialize with the drawingboard. 'Colors', 'Size', and 'Navigation' by default
 *		instead of simple strings, you can pass an object to define a control opts
 *		ie ['Color', { Navigation: { reset: false }}]
 *	controlsPosition: "top left" by default. Define where to put the controls: at the "top" or "bottom" of the canvas, aligned to "left"/"right"/"center"
 *	background: background of the drawing board. Give a hex color or an image url "#ffffff" (white) by default
 *	color: pencil color ("#000000" by default)
 *	size: pencil size (3 by default)
 *	webStorage: 'session', 'local' or false ('session' by default). store the current drawing in session or local storage and restore it when you come back
 *	droppable: true or false (false by default). If true, dropping an image on the canvas will include it and allow you to draw on it,
 *	errorMessage: html string to put in the board's element on browsers that don't support canvas.
 * }
 */
DrawingBoard.Board = function(id, opts) {
  var self = this;
	this.opts = $.extend({}, DrawingBoard.Board.defaultOpts, opts);

  this.goinstant = {
    room: this.opts.goinstant.room,
    userKey: this.opts.goinstant.userKey,
    channels: {
      isDrawing: this.opts.goinstant.room.channel('isDrawing'),
      isMouseHovering: this.opts.goinstant.room.channel('isMouseHovering'),
      currentCoords: this.opts.goinstant.room.channel('currentCoords'),
      fill: this.opts.goinstant.room.channel('fill'),
      lineWidth: this.opts.goinstant.room.channel('lineWidth'),
      strokeStyle: this.opts.goinstant.room.channel('strokeStyle'),
      reset: this.opts.goinstant.room.channel('reset'),
      navForward: this.opts.goinstant.room.channel('navForward'),
      navBackward: this.opts.goinstant.room.channel('navBackward')
    }
  };
  this.userData = {};

	this.ev = new DrawingBoard.Utils.MicroEvent();

	this.id = id;
	this.$el = $(document.getElementById(id));
	if (!this.$el.length)
		return false;

  var shortUserName = this.goinstant.userKey.name.substr("/.users/guest:".length);
	var tpl = '<div class="drawing-board-canvas-wrapper"></canvas><canvas class="drawing-board-canvas"></canvas></div>';
	if (this.opts.controlsPosition.indexOf("bottom") > -1) tpl += '<div class="drawing-board-controls"></div>';
	else tpl = '<div class="drawing-board-controls"></div>' + tpl;

	this.$el.addClass('drawing-board').append(tpl);
	this.dom = {
		$canvasWrapper: this.$el.find('.drawing-board-canvas-wrapper'),
		$canvas: this.$el.find('.drawing-board-canvas'),
		$cursor: this.$el.find('.drawing-board-cursor'),
		$controls: this.$el.find('.drawing-board-controls')
	};

	$.each(['left', 'right', 'center'], $.proxy(function(n, val) {
		if (this.opts.controlsPosition.indexOf(val) > -1) {
			this.dom.$controls.attr('data-align', val);
			return false;
		}
	}, this));

	this.canvas = this.dom.$canvas.get(0);
	this.ctx = this.canvas && this.canvas.getContext && this.canvas.getContext('2d') ? this.canvas.getContext('2d') : null;
	this.color = this.opts.color;

  self.goinstant.room.users(function(err, userMap, keyMap) {
    _.forEach(_.keys(userMap), function(curUserKey) {
      self.initUserData(keyMap[curUserKey].name, userMap[curUserKey]);
    });
    var channels = self.goinstant.channels;

    channels.isDrawing.on('message', function(msg) {
      self.userData[msg.username].isDrawing = msg.val;
    });
    channels.isMouseHovering.on('message', function(msg) {
      if (msg.val.isMouseHovering) {
        self.userData[msg.username].coords.old = msg.val.old;
        self.userData[msg.username].coords.oldMid = msg.val.oldMid;
      } 
      self.userData[msg.username].isMouseHovering = msg.val.isMouseHovering;
    });
    channels.currentCoords.on('message', function(msg) {
      self.userData[msg.username].coords.current = msg.val;
    });
    channels.fill.on('message', function(msg) {
      self.fill({
        coords: msg.val,
        strokeStyle: self.userData[msg.username].strokeStyle,
        isRemoteEvent: true
      });
      self.userData[msg.username].coords.fill = msg.val;

    });
    channels.lineWidth.on('message', function(msg) {
      self.userData[msg.username].lineWidth = msg.val;
    });
    channels.strokeStyle.on('message', function(msg) {
      self.userData[msg.username].strokeStyle = msg.val;
    });

    if (!this.ctx) {
      if (this.opts.errorMessage)
        this.$el.html(this.opts.errorMessage);
      return false;
    }
    this.storage = this._getStorage();

    this.initHistory();
    //init default board values before controls are added (mostly pencil color and size)
    this.reset({ webStorage: false, history: false, background: false });
    //init controls (they will need the default board values to work like pencil color and size)
    this.initControls();
    //set board's size after the controls div is added
    this.resize();
    //reset the board to take all resized space
    this.reset({ webStorage: false, history: true, background: true });
    this.restoreWebStorage();
    this.initDropEvents();
    this.initDrawEvents();
  }.bind(this));

  // subscribe to events for all users
  function initializeUserData() {
  }

  self.goinstant.room.on('join', function(userObj) {
    self.initUserData('/.users/' + userObj.id, userObj);
  });

  /*
  self.goinstant.room.key('/history/length').on('set', {
    listener: function(val, context) {
      self.goinstant.room.key('/history').get(function(err, val) {
        if (err) {
          throw err;
        }
        var img = "";
        _.forEach(val, function(item) {
          img += item;
        });
        self.setImg(img);
      });
    }
  });
  */

};



DrawingBoard.Board.defaultOpts = {
	controls: ['Color', 'DrawingMode', 'Size', 'Navigation'],
	controlsPosition: "top left",
	color: "#000000",
	size: 1,
	background: "#fff",
	eraserColor: "background",
	webStorage: 'session',
	droppable: false,
	enlargeYourContainer: false,
	errorMessage: "<p>It seems you use an obsolete browser. <a href=\"http://browsehappy.com/\" target=\"_blank\">Update it</a> to start drawing.</p>"
};


function throwIfError(err) {
  if (err) {
    throw err;
  }
}

DrawingBoard.Board.prototype = {

  setCursorColor: function(userName, color) {
    var shortUserName = userName.substr("/.users/guest:".length);
    var cursorId = "cursor-"+ shortUserName;
    var r = parseInt(color.substr(1, 2), 16);
    var g = parseInt(color.substr(3, 2), 16);
    var b = parseInt(color.substr(5, 2), 16);
    var div = '<div id="' + cursorId + '" class="drawing-board-cursor drawing-board-utils-hidden" style="background: rgba(' + r + ',' + g + ',' + b + ', 0.4);"></div>';
    $(".drawing-board-canvas-wrapper").append(div);
    this.userData[userName].cursor = $("#"+cursorId);
  },

	/**
	 * Canvas reset/resize methods: put back the canvas to its default values
	 *
	 * depending on options, can set color, size, background back to default values
	 * and store the reseted canvas in webstorage and history queue
	 *
	 * resize values depend on the `enlargeYourContainer` option
	 */

  initUserData: function(userName, userObj) {
    this.userData[userName] = {
      isDrawing: false,
      isMouseHovering: false,
      coords: {
        current: { x: 0, y: 0 },
        old: { x: 0, y: 0 },
        oldMid: { x: 0, y: 0 },
        fill: { x: 0, y: 0 }
      },
      lineWidth: this.ctx.lineWidth,
      strokeStyle: this.ctx.strokeStyle,
    };

    if (userObj.avatarColor) {
      this.setCursorColor(userName, userObj.avatarColor);
    } else {
      this.goinstant.room.key(userName).key('/avatarColor').on('set', function(val) {
        this.setCursorColor(userName, val);
      }.bind(this));
    }
  },

	reset: function(opts) {
		opts = $.extend({
			color: this.opts.color,
			size: this.opts.size,
			webStorage: true,
			history: true,
			background: false
		}, opts);

		this.setMode('pencil');

		if (opts.background) this.resetBackground(this.opts.background, false);

		if (opts.color) this.setColor(opts.color);
		if (opts.size) this.ctx.lineWidth = opts.size;

		this.ctx.lineCap = "round";
		this.ctx.lineJoin = "round";

		if (opts.webStorage) this.saveWebStorage();

		if (opts.history) this.saveHistory();

		this.blankCanvas = this.getImg();

		this.ev.trigger('board:reset', opts);
	},

	resetBackground: function(background, historize) {
		background = background || this.opts.background;
		historize = typeof historize !== "undefined" ? historize : true;
		var bgIsColor = DrawingBoard.Utils.isColor(background);
		var prevMode = this.getMode();
		this.setMode('pencil');
		this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.width);
		if (bgIsColor) {
			this.ctx.fillStyle = background;
			this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
		} else if (background)
			this.setImg(background);
		this.setMode(prevMode);
		if (historize) this.saveHistory();
	},

	resize: function() {
		this.dom.$controls.toggleClass('drawing-board-controls-hidden', (!this.controls || !this.controls.length));

		var canvasWidth, canvasHeight;
		var widths = [
			this.$el.width(),
			DrawingBoard.Utils.boxBorderWidth(this.$el),
			DrawingBoard.Utils.boxBorderWidth(this.dom.$canvasWrapper, true, true)
		];
		var heights = [
			this.$el.height(),
			DrawingBoard.Utils.boxBorderHeight(this.$el),
			this.dom.$controls.height(),
			DrawingBoard.Utils.boxBorderHeight(this.dom.$controls, false, true),
			DrawingBoard.Utils.boxBorderHeight(this.dom.$canvasWrapper, true, true)
		];
		var that = this;
		var sum = function(values, multiplier) { //make the sum of all array values
			multiplier = multiplier || 1;
			var res = values[0];
			for (var i = 1; i < values.length; i++) {
				res = res + (values[i]*multiplier);
			}
			return res;
		};
		var sub = function(values) { return sum(values, -1); }; //substract all array values from the first one

		if (this.opts.enlargeYourContainer) {
			canvasWidth = this.$el.width();
			canvasHeight = this.$el.height();

			this.$el.width( sum(widths) );
			this.$el.height( sum(heights) );
		} else {
			canvasWidth = sub(widths);
			canvasHeight = sub(heights);
		}

		this.dom.$canvasWrapper.css('width', canvasWidth + 'px');
		this.dom.$canvasWrapper.css('height', canvasHeight + 'px');

		this.dom.$canvas.css('width', canvasWidth + 'px');
		this.dom.$canvas.css('height', canvasHeight + 'px');

		this.canvas.width = canvasWidth;
		this.canvas.height = canvasHeight;
	},



	/**
	 * Controls:
	 * the drawing board can has various UI elements to control it.
	 * one control is represented by a class in the namespace DrawingBoard.Control
	 * it must have a $el property (jQuery object), representing the html element to append on the drawing board at initialization.
	 *
	 */

	initControls: function() {
		this.controls = [];
		if (!this.opts.controls.length || !DrawingBoard.Control) return false;
		for (var i = 0; i < this.opts.controls.length; i++) {
			var c = null;
			if (typeof this.opts.controls[i] == "string") {
        c = new window.DrawingBoard.Control[this.opts.controls[i]](this);
      } else if (typeof this.opts.controls[i] == "object") {
				for (var controlName in this.opts.controls[i]) break;
				c = new window.DrawingBoard.Control[controlName](this, this.opts.controls[i][controlName]);
			}
			if (c) {
				this.addControl(c);
			}
		}
	},

	//add a new control or an existing one at the position you want in the UI
	//to add a totally new control, you can pass a string with the js class as 1st parameter and control options as 2nd ie "addControl('Navigation', { reset: false }"
	//the last parameter (2nd or 3rd depending on the situation) is always the position you want to place the control at
	addControl: function(control, optsOrPos, pos) {
		if (typeof control !== "string" && (typeof control !== "object" || !control instanceof DrawingBoard.Control))
			return false;

		var opts = typeof optsOrPos == "object" ? optsOrPos : {};
		pos = pos ? pos*1 : (typeof optsOrPos == "number" ? optsOrPos : null);

		if (typeof control == "string")
			control = new window.DrawingBoard.Control.control(this, opts);

		if (pos)
			this.dom.$controls.children().eq(pos).before(control.$el);
		else
			this.dom.$controls.append(control.$el);

		if (!this.controls)
			this.controls = [];
		this.controls.push(control);
		this.dom.$controls.removeClass('drawing-board-controls-hidden');
	},



	/**
	 * History methods: undo and redo drawed lines
	 */

	initHistory: function() {
		this.history = {
			values: [],
			position: 0
		};
	},

	saveHistory: function () {
		while (this.history.values.length > 30) {
			this.history.values.shift();
			this.history.position--;
		}
		if (this.history.position !== 0 && this.history.position < this.history.values.length) {
			this.history.values = this.history.values.slice(0, this.history.position);
			this.history.position++;
		} else {
			this.history.position = this.history.values.length+1;
		}
    /*
    this.goinstant.room.key('/history/position').set(this.history.position, function(err) {
      if (err) {
        throw err;
      }
    }.bind(this));
    */
    this.history.values.push(this.getImg());
    this.ev.trigger('historyNavigation', this.history.position);
	},

	_goThroughHistory: function(goForth) {
		if ((goForth && this.history.position == this.history.values.length) ||
			(!goForth && this.history.position == 1))
			return;
		var pos = goForth ? this.history.position+1 : this.history.position-1;
		if (this.history.values.length && this.history.values[pos-1] !== undefined) {
			this.history.position = pos;
			this.setImg(this.history.values[pos-1]);
		}
		this.ev.trigger('historyNavigation', pos);
	},

	goBackInHistory: function() {
		this._goThroughHistory(false);
    setTimeout(function(){
      this.saveWebStorage();
    }.bind(this), 1);
	},

	goForthInHistory: function() {
		this._goThroughHistory(true);
    setTimeout(function(){
      this.saveWebStorage();
    }.bind(this), 1);
	},



	/**
	 * Image methods: you can directly put an image on the canvas, get it in base64 data url or start a download
	 */

	setImg: function(src) {
		var ctx = this.ctx;
		var img = new Image();
		var oldGCO = ctx.globalCompositeOperation;
		img.onload = function() {
			ctx.globalCompositeOperation = "source-over";
			ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.width);
			ctx.drawImage(img, 0, 0);
			ctx.globalCompositeOperation = oldGCO;
		};
		img.src = src;
	},

	getImg: function() {
		return this.canvas.toDataURL("image/png");
	},

	downloadImg: function() {
		var img = this.getImg();
		img = img.replace("image/png", "image/octet-stream");
		window.location.href = img;
	},



	/**
	 * WebStorage handling : save and restore to local or session storage
	 */
  splitStringIntoChunks: function(inputStr, maxLength) {
    var numElements = (inputStr.length + maxLength - 1) / maxLength;
    var stringChunks = [];
    var start, end, chunk, i;
    for (i = 0; i < numElements; ++i) {
      start = i * maxLength;
      end = Math.min(inputStr.length, start + maxLength);
      chunk = inputStr.substring(start, end);
      if (chunk) {
        stringChunks.push(chunk);
      }
    }
    return stringChunks;
  },

	saveWebStorage: function() {
		if (window[this.storage]) {
			window[this.storage].setItem('drawing-board-' + this.id, this.getImg());
			this.ev.trigger('board:save' + this.storage.charAt(0).toUpperCase() + this.storage.slice(1), this.getImg());
		}

    var historyKey = this.goinstant.room.key('/history');
    var mutexKey = historyKey.key('/mutex');
    mutexKey.set(this.goinstant.userKey.name, {
      overwrite: false
    }, function(err)  {
      if (err instanceof goinstant.errors.CollisionError) {
        // mutex was already set by someone else, exit...
        return;
      }
      var chunksArr = this.splitStringIntoChunks(this.getImg(), 10000);
      historyKey.remove(function(err) {
        var options = {
          bubble: true
        };
        var tasks = [];
        for(var i = 0; i < chunksArr.length; ++i) {
          var chunkKey = historyKey.key('/' + i);
          tasks.push(chunkKey.set.bind(chunkKey, chunksArr[i], options));
        }
        async.series(tasks, function(err, res) {
          if (err) {
            throw err;
          }
          historyKey.key("/length").set(chunksArr.length, options, function(err) {
            if (err) {
              throw err;
            }
            mutexKey.remove(function(err) {
              if (err) {
                throw err;
              }
            });
          }.bind(this));
        }.bind(this));
      }.bind(this));
    }.bind(this));
	},

	restoreWebStorage: function() {
    this.goinstant.room.key('/history').get(function(err, val) {
      if (val) {
        var img = "";
        _.forEach(val, function(item) {
          img += item;
        });
        this.setImg(img);
      }
    }.bind(this));
		if (window[this.storage] && window[this.storage].getItem('drawing-board-' + this.id) !== null) {
			this.ev.trigger('board:restore' + this.storage.charAt(0).toUpperCase() + this.storage.slice(1), window[this.storage].getItem('drawing-board-' + this.id));
		}
	},

	clearWebStorage: function() {
		if (window[this.storage] && window[this.storage].getItem('drawing-board-' + this.id) !== null) {
			window[this.storage].removeItem('drawing-board-' + this.id);
			this.ev.trigger('board:clear' + this.storage.charAt(0).toUpperCase() + this.storage.slice(1));
		}
    var historyKey = this.goinstant.room.key('/history');
    historyKey.remove(throwIfError);
	},

	_getStorage: function() {
		if (!this.opts.webStorage || !(this.opts.webStorage === 'session' || this.opts.webStorage === 'local')) return false;
		return this.opts.webStorage + 'Storage';
	},



	/**
	 * Drop an image on the canvas to draw on it
	 */

	initDropEvents: function() {
		if (!this.opts.droppable)
			return false;

		this.dom.$canvas.on('dragover dragenter drop', function(e) {
			e.stopPropagation();
			e.preventDefault();
		});

		this.dom.$canvas.on('drop', $.proxy(this._onCanvasDrop, this));
	},

	_onCanvasDrop: function(e) {
		e = e.originalEvent ? e.originalEvent : e;
		var files = e.dataTransfer.files;
		if (!files || !files.length || files[0].type.indexOf('image') == -1 || !window.FileReader)
			return false;
		var fr = new FileReader();
		fr.readAsDataURL(files[0]);
		fr.onload = $.proxy(function(ev) {
			this.setImg(ev.target.result);
			this.ev.trigger('board:imageDropped', ev.target.result);
			this.ev.trigger('board:userAction');
			this.saveHistory();
		}, this);
	},



	/**
	 * set and get current drawing mode
	 *
	 * possible modes are "pencil" (draw normally), "eraser" (draw transparent, like, erase, you know), "filler" (paint can)
	 */

  setMode: function(newMode, silent) {
    silent = silent || false;
    newMode = newMode || 'pencil';

    this.ev.unbind('board:startDrawing', $.proxy(this.fill, this));

    if (this.opts.eraserColor === "transparent") {
      this.ctx.globalCompositeOperation = newMode === "eraser" ? "destination-out" : "source-over";
    } else {
      if (newMode === "eraser") {
        if (this.opts.eraserColor === "background" && DrawingBoard.Utils.isColor(this.opts.background)) {
          this.ctx.strokeStyle = this.opts.background;
        } else if (DrawingBoard.Utils.isColor(this.opts.eraserColor)) {
          this.ctx.strokeStyle = this.opts.eraserColor;
        }
      } else if (!this.mode || this.mode === "eraser") {
        this.ctx.strokeStyle = this.color;
      }

      this.goinstant.channels.strokeStyle.message({
        username: this.goinstant.userKey.name,
        val: this.ctx.strokeStyle
      }, function(err) {
        if (err) {
          throw err;
        }
        this.goinstant.room.key(this.goinstant.userKey.name).set(this.userData[this.goinstant.userKey.name]);
      }.bind(this));

      this.userData[this.goinstant.userKey.name].strokeStyle = this.ctx.strokeStyle;

      if (newMode === "filler")
        this.ev.bind('board:startDrawing', $.proxy(this.fill, this));
    }
    this.mode = newMode;
    if (!silent)
      this.ev.trigger('board:mode', this.mode);
  },

	getMode: function() {
		return this.mode || "pencil";
	},

	setColor: function(color) {
		var that = this;
		color = color || this.color;
		if (!DrawingBoard.Utils.isColor(color))
			return false;
		this.color = color;
		if (this.opts.eraserColor !== "transparent" && this.mode === "eraser") {
			var setStrokeStyle = function(mode) {
				if (mode !== "eraser") {
          that.strokeStyle = that.color;
        }
				that.ev.unbind('board:mode', setStrokeStyle);
			};
			this.ev.bind('board:mode', setStrokeStyle);
		} else {
      this.ctx.strokeStyle = this.color;
    }
    this.userData[this.goinstant.userKey.name].strokeStyle = this.ctx.strokeStyle;
    this.goinstant.channels.strokeStyle.message({
      username: this.goinstant.userKey.name,
      val: this.ctx.strokeStyle
    }, function(err) {
      if (err) {
        throw err;
      }
      this.goinstant.room.key(this.goinstant.userKey.name).set(this.userData[this.goinstant.userKey.name]);
    }.bind(this));
	},

	/**
	 * Fills an area with the current stroke color.
	 */
	fill: function(e) {
		if (this.getImg() === this.blankCanvas) {
			this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.width);
			this.ctx.fillStyle = this.color;
			this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
			return;
		}

		var img = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

		// constants identifying pixels components
		var INDEX = 0, X = 1, Y = 2, COLOR = 3;

		// target color components
    var stroke;
    if (e.isRemoteEvent) {
      stroke = e.strokeStyle;
    } else {
      stroke = this.ctx.strokeStyle;
    }
		var r = parseInt(stroke.substr(1, 2), 16);
		var g = parseInt(stroke.substr(3, 2), 16);
		var b = parseInt(stroke.substr(5, 2), 16);

		// starting point
		var start = DrawingBoard.Utils.pixelAt(img, parseInt( e.coords.x, 10), parseInt( e.coords.y, 10));

		// no need to continue if starting and target colors are the same
		if (start[COLOR] === DrawingBoard.Utils.RGBToInt(r, g, b))
			return;

		// pixels to evaluate
		var queue = [start];

		// loop vars
		var pixel, x, y;
		var maxX = img.width - 1;
		var maxY = img.height - 1;

		while ((pixel = queue.pop())) {
			if (pixel[COLOR] === start[COLOR]) {
				img.data[pixel[INDEX]] = r;
				img.data[pixel[INDEX] + 1] = g;
				img.data[pixel[INDEX] + 2] = b;
				if (pixel[X] > 0) // west
					queue.push(DrawingBoard.Utils.pixelAt(img, pixel[X] - 1, pixel[Y]));
				if (pixel[X] < maxX) // east
					queue.push(DrawingBoard.Utils.pixelAt(img, pixel[X] + 1, pixel[Y]));
				if (pixel[Y] > 0) // north
					queue.push(DrawingBoard.Utils.pixelAt(img, pixel[X], pixel[Y] - 1));
				if (pixel[Y] < maxY) // south
					queue.push(DrawingBoard.Utils.pixelAt(img, pixel[X], pixel[Y] + 1));
			}
		}

		this.ctx.putImageData(img, 0, 0);

    if (!e.isRemoteEvent) {
      var newFillCoords = e.coords;
      this.goinstant.channels.fill.message({
        username: this.goinstant.userKey.name,
        val: newFillCoords
      }, function(err) {
        if (err) {
          throw err;
        }
        this.userData[this.goinstant.userKey.name].coords.fill = newFillCoords;
      }.bind(this));
    }
	},


	/**
	 * Drawing handling, with mouse or touch
	 */

	initDrawEvents: function() {
		this.dom.$canvas.on('mousedown touchstart', $.proxy(function(e) {
			this._onInputStart(e, this._getInputCoords(e) );
		}, this));

		this.dom.$canvas.on('mousemove touchmove', $.proxy(function(e) {
			this._onInputMove(e, this._getInputCoords(e) );
		}, this));

		this.dom.$canvas.on('mousemove', $.proxy(function(e) {

		}, this));

		this.dom.$canvas.on('mouseup touchend', $.proxy(function(e) {
			this._onInputStop(e, this._getInputCoords(e) );
		}, this));

		this.dom.$canvas.on('mouseover', $.proxy(function(e) {
			this._onMouseOver(e, this._getInputCoords(e) );
		}, this));

		this.dom.$canvas.on('mouseout', $.proxy(function(e) {
			this._onMouseOut(e, this._getInputCoords(e) );

		}, this));

		$('body').on('mouseup touchend', $.proxy(function(e) {
      this.goinstant.channels.isDrawing.message({
        username: this.goinstant.userKey.name,
        val: false
      }, function(err) {
        if (err) {
          throw err;
        }
        this.userData[this.goinstant.userKey.name].isDrawing = false;
        this.goinstant.room.key(this.goinstant.userKey.name).key('data').set(this.userData[this.goinstant.userKey.name]);
      }.bind(this));
		}, this));

		if (window.requestAnimationFrame) {
      requestAnimationFrame( $.proxy(this.draw, this) );
    }
	},

	draw: function() {
    _.forEach(this.userData, function(currentUserData) {
      this.ctx.lineWidth = currentUserData.lineWidth;
      this.ctx.strokeStyle = currentUserData.strokeStyle;

      //if the pencil size is big (>10), the small crosshair makes a friend: a circle of the size of the pencil
      //todo: have the circle works on every browser - it currently should be added only when CSS pointer-events are supported
      //we assume that if requestAnimationFrame is supported, pointer-events is too, but this is terribad.
      if (currentUserData.cursor) {
        if (window.requestAnimationFrame && currentUserData.isMouseHovering) {
          var cursorWidth = this.ctx.lineWidth > 1 ? this.ctx.lineWidth : 2;
          currentUserData.cursor.css({ width: cursorWidth + 'px', height: cursorWidth + 'px' });
          var transform = DrawingBoard.Utils.tpl("translateX({{x}}px) translateY({{y}}px)", {
            x: currentUserData.coords.current.x-(cursorWidth/2),
            y: currentUserData.coords.current.y-(cursorWidth/2)
          });
          currentUserData.cursor.css({
            'transform': transform,
            '-webkit-transform': transform,
            '-ms-transform': transform });
          currentUserData.cursor.removeClass('drawing-board-utils-hidden');
        } else {
          currentUserData.cursor.addClass('drawing-board-utils-hidden');
        }
      }

      var currentMid = this._getMidInputCoords(currentUserData.coords.old,currentUserData.coords.current);
      if (currentUserData.isDrawing) {
        // TODO: use all code from setColor
        this.ctx.beginPath();
        this.ctx.moveTo(currentMid.x, currentMid.y);
        this.ctx.quadraticCurveTo(currentUserData.coords.old.x, currentUserData.coords.old.y, currentUserData.coords.oldMid.x, currentUserData.coords.oldMid.y);
        this.ctx.stroke();
      }
      currentUserData.coords.oldMid = currentMid;
      currentUserData.coords.old = currentUserData.coords.current;
    }.bind(this));
    this.ctx.strokeStyle = this.userData[this.goinstant.userKey.name].strokeStyle;
    this.ctx.lineWidth = this.userData[this.goinstant.userKey.name].lineWidth;
    if (window.requestAnimationFrame) {
      requestAnimationFrame( $.proxy(function() { this.draw(); }, this) );
    }
	},

	_onInputStart: function(e, coords) {
    var userName = this.goinstant.userKey.name;
    var channels = this.goinstant.channels;

    var newValues = {
      current: coords,
      old: coords,
      oldMid: this._getMidInputCoords(coords, coords),
      isDrawing: true
    };

    async.series([
      channels.currentCoords.message.bind(channels.currentCoords,{
        username: userName,
        val: newValues.current
      }),
      channels.isDrawing.message.bind(channels.isDrawing,{
        username: userName,
        val: newValues.isDrawing
      })
    ], function(err) {
      if (err) {
        throw err;
      }

      this.userData[userName].coords.current = newValues.current;
      this.userData[userName].coords.old = newValues.old;
      this.userData[userName].coords.oldMid = newValues.oldMid;
      this.userData[userName].isDrawing = newValues.isDrawing;

      this.goinstant.room.key(this.goinstant.userKey.name).key('/data').set(this.userData[userName]);
      
      this.ev.trigger('board:startDrawing', {e: e, coords: coords});

      if (!window.requestAnimationFrame) {
        this.draw();
      }

    }.bind(this));
		e.preventDefault();
	},

	_onInputMove: function(e, coords) {
    var userName = this.goinstant.userKey.name;
    var channels = this.goinstant.channels;
    var userObj = this.userData[userName];

    channels.currentCoords.message({
      username: userName,
      val: coords
    }, function(err) {
      userObj.coords.current = coords;
      this.ev.trigger('board:drawing', {e: e, coords: coords});
      if (!window.requestAnimationFrame) {
        this.draw();
      }

    }.bind(this));
		e.preventDefault();
	},

	_onInputStop: function(e, coords) {
    var userName = this.goinstant.userKey.name;
    var channels = this.goinstant.channels;
    var userObj = this.userData[userName];

    if (userObj.isDrawing && (!e.touches || e.touches.length === 0)) {
      channels.isDrawing.message({
        username: userName,
        val: false
      }, function(err) {
        userObj.isDrawing = false;
        this.goinstant.room.key(this.goinstant.userKey.name).key('/data').set(this.userData[userName]);
        this.saveHistory();
        this.saveWebStorage();

        this.ev.trigger('board:stopDrawing', {e: e, coords: coords});
        this.ev.trigger('board:userAction');
      }.bind(this));
      e.preventDefault();
		}
	},

	_onMouseOver: function(e, coords) {
    var userName = this.goinstant.userKey.name;
    var channels = this.goinstant.channels;
    var userObj = this.userData[userName];

    var inputCoords = this._getInputCoords(e);
    var newValues = {
      isMouseHovering: true,
      old: inputCoords,
      oldMid: this._getMidInputCoords(inputCoords, inputCoords)
    };

      async.series([
        channels.isMouseHovering.message.bind(channels.isMouseHovering, {
          username: userName,
          val: newValues
        })
      ], function(err) {
        if (err) {
          throw err;
        }
        userObj.isMouseHovering = newValues.isMouseHovering;
        userObj.coords.old = newValues.old;
        userObj.coords.oldMid = newValues.oldMid;
        this.ev.trigger('board:mouseOver', {e: e, coords: coords});
      }.bind(this));
	},

	_onMouseOut: function(e, coords) {
    var userName = this.goinstant.userKey.name;
    var channels = this.goinstant.channels;
    var userObj = this.userData[userName];

    var newValues = {
      isMouseHovering: false
    };

    channels.isMouseHovering.message({
      username: this.goinstant.userKey.name,
      val: newValues
    }, function(err) {
      if (err) {
        throw err;
      }
      userObj.isMouseHovering = newValues.isMouseHovering;
      this.ev.trigger('board:mouseOut', {e: e, coords: coords});
    }.bind(this));
	},

	_getInputCoords: function(e) {
		e = e.originalEvent ? e.originalEvent : e;
		var x, y;
		if (e.touches && e.touches.length == 1) {
			x = e.touches[0].pageX;
			y = e.touches[0].pageY;
		} else {
			x = e.pageX;
			y = e.pageY;
		}
		return {
			x: x - this.dom.$canvas.offset().left,
			y: y - this.dom.$canvas.offset().top
		};
	},

	_getMidInputCoords: function(oldCoords, coords) {
		return {
			x: oldCoords.x + coords.x>>1,
			y: oldCoords.y + coords.y>>1
		};
	}
};
