//////////////////////////////////////////////////
// FireGesturesRemote

let { classes: Cc, interfaces: Ci, utils: Cu } = Components;

const HTML_NS = "http://www.w3.org/1999/xhtml";

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "BrowserUtils", "resource://gre/modules/BrowserUtils.jsm");

// #debug-begin
Cu.import("resource://gre/modules/Services.jsm");
function log(aText) {
	Services.console.logStringMessage("FireGesturesRemote> " + aText);
}
// #debug-end

let FireGesturesRemote = {

	init: function FGR_init() {
		log("init: " + new Date().toLocaleTimeString());	// #debug
		addMessageListener("FireGestures:GestureStart", this);
		addMessageListener("FireGestures:KeypressStart", this);
		addMessageListener("FireGestures:KeypressProgress", this);
		addMessageListener("FireGestures:KeypressStop", this);
		addMessageListener("FireGestures:ContextMenu", this);
		addMessageListener("FireGestures:DoCommand", this);
		addMessageListener("FireGestures:SendKeyEvent", this);
		addMessageListener("FireGestures:CreateTrail", this);
		addMessageListener("FireGestures:DrawTrail", this);
		addMessageListener("FireGestures:EraseTrail", this);
	},

	receiveMessage: function FGR_receiveMessage(aMsg) {
		// log("receiveMessage: " + aMsg.name + "\t" + aMsg.data.toSource());	// #debug
		switch (aMsg.name) {
			case "FireGestures:GestureStart"    : this._onGestureStart(aMsg.data); break;
			case "FireGestures:KeypressStart"   : this._onKeypressStart(); break;
			case "FireGestures:KeypressProgress": this._onKeypressProgress(aMsg.data); break;
			case "FireGestures:KeypressStop"    : this._onKeypressStop(); break;
			case "FireGestures:ContextMenu" : this._displayContextMenu(aMsg.data); break;
			case "FireGestures:DoCommand"   : this._doCommand(aMsg.data); break;
			case "FireGestures:SendKeyEvent": this._sendKeyEvent(aMsg.data); break;
			case "FireGestures:CreateTrail" : this._createTrail(aMsg.data); break;
			case "FireGestures:DrawTrail"   : this._drawTrail(aMsg.data); break;
			case "FireGestures:EraseTrail"  : this._eraseTrail(); break;
		}
	},


	/* ::::: Mouse Gesture ::::: */

	// coordinates which the gesture starts, originated on the left-upper corner of browser
	_startX: 0,
	_startY: 0,

	_onGestureStart: function FGR__onGestureStart(aData) {
		log("onStartGesture: " + aData.toSource());	// #debug
		this._startX = aData.x;
		this._startY = aData.y;
		let { doc: doc, elt: elt } = this._elementFromPoint(aData.x, aData.y);
		if (aData.button == 0) {
			// cancel starting gesture on form elements
			let localName = elt.localName;
			if (["input", "textarea", "select", "option", "textbox", "menulist"].indexOf(localName) >= 0) {
				log("*** cancel starting gesture on form element (" + localName + ")");	// #debug
				sendSyncMessage("FireGesturesRemote:Response", { name: "cancelMouseGesture" }, {});
				return;
			}
			// ready for cancel mouse gesture if gesture starts on scrollbar
			let win = doc.defaultView;
			win.removeEventListener("scroll", this, false);
			win.addEventListener("scroll", this, false);
			// cancel selecting ranges
			let sel = win.getSelection();
			if (sel.isCollapsed)
				win.setTimeout(function() { sel.removeAllRanges(); }, 10);
		}
		// tell parent browser the source node and some info
		sendSyncMessage("FireGesturesRemote:Response", { name: "sourceNode" }, { elt: elt });
	},

	handleEvent: function(event) {
		switch (event.type) {
			case "scroll": 
				let win = event.target.defaultView;
				win.removeEventListener("scroll", this, false);
				sendSyncMessage("FireGesturesRemote:Response", { name: "cancelMouseGesture" }, {});
				log("*** cancel starting gesture on scrollbar");	// #debug
				break;
			default: 
		}
	},


	/* ::::: Keypress Gesture ::::: */

	_linkURLs: null,
	_linkElts: null,

	_onKeypressStart: function FGR__onKeypressStart() {
		this._linkURLs = [];
		this._linkElts = [];
	},

	_onKeypressProgress: function FGR__onKeypressProgress(aData) {
		let { doc: doc, elt: elt } = this._elementFromPoint(aData.x, aData.y);
		let linkURL = this.getLinkURL(elt);
		if (!this._linkURLs)
			this._linkURLs = [];
		if (!linkURL || this._linkURLs.indexOf(linkURL) >= 0)
			return;
		try {
			BrowserUtils.urlSecurityCheck(linkURL, doc.nodePrincipal);
		}
		catch(ex) {
			// unsafe link
			return;
		}
		this._linkURLs.push(linkURL);
		this._linkElts.push(elt);
		elt.style.outline = "1px dashed darkorange";
		// tell parent browser the array of link URL
		sendSyncMessage("FireGesturesRemote:Response", { name: "linkURLs", linkURLs: this._linkURLs });
	},

	_onKeypressStop: function FGR__onKeypressStop() {
		for (let i = 0; i < this._linkURLs.length; i++) {
			this._linkElts[i].style.outline = "";
			this._linkElts[i] = null;	// just in case
		}
		this._linkURLs = null;
		this._linkElts = null;
	},

	getLinkURL: function FGR_getLinkURL(aNode) {
		while (aNode) {
			if (aNode instanceof Ci.nsIDOMHTMLAnchorElement || aNode instanceof Ci.nsIDOMHTMLAreaElement) {
				if (aNode.href)
					return aNode.href;
			}
			aNode = aNode.parentNode;
		}
		// not on a link
		return null;
	},


	/* ::::: Commands ::::: */

	_displayContextMenu: function FGR__displayContextMenu(aData) {
		// log("_displayContextMenu: " + aData.toSource());	// #debug
		let { doc: doc, elt: elt, x: x, y: y } = this._elementFromPoint(aData.x, aData.y);
		// open the context menu artificially
		let evt = doc.createEvent("MouseEvents");
		evt.initMouseEvent(
			"contextmenu", true, true, doc.defaultView, 0,
			aData.x, aData.y, x, y,
			false, false, false, false, 2, null
		);
		elt.dispatchEvent(evt);
	},

	_doCommand: function FGR__doCommand(aData) {
		if (docShell.isCommandEnabled(aData.cmd))
			docShell.doCommand(aData.cmd);
	},

	_sendKeyEvent: function FGR__sendKeyEvent(aOptions) {
		let { elt: elt, doc: doc } = this._elementFromPoint(this._startX, this._startY);
		let evt = doc.createEvent("KeyEvents");
		evt.initKeyEvent(
			"keypress", true, true, null, 
			aOptions.ctrl  || false, 
			aOptions.alt   || false, 
			aOptions.shift || false, 
			aOptions.meta  || false, 
			aOptions.keyCode ? evt[aOptions.keyCode] : null, 
			aOptions.key ? aOptions.key.charCodeAt(0) : null
		);
		elt.dispatchEvent(evt);
	},


	/* ::::: Utils ::::: */

//	// returns DOM element and some related data which is under the mouse pointer
//	_elementAtPointer: function FGR__elementAtPointer() {
//		let doc = content.document;
//		let elt = doc.querySelector(":hover") || doc.body || doc.documentElement;
//		while (/^i?frame$/.test(elt.localName.toLowerCase())) {
//			doc = elt.contentDocument;
//			elt = doc.querySelector(":hover");
//		}
//		log("_elementAtPointer: " + [doc.location, elt.localName].join(", "));	// #debug
//		return elt;
//	},

	// returns DOM element and some data related which is located at given coordinates
	_elementFromPoint: function FGR__elementFromPoint(x, y) {
		let doc = content.document;
		let elt = doc.elementFromPoint(x, y) || doc.body || doc.documentElement;
		while (/^i?frame$/.test(elt.localName.toLowerCase())) {
			x -= elt.getBoundingClientRect().left;
			y -= elt.getBoundingClientRect().top;
			doc = elt.contentDocument;
			elt = doc.elementFromPoint(x, y);
		}
		// log("_elementFromPoint: " + [doc.location, elt.localName, x, y].join(", "));	// #debug
		return { doc: doc, elt: elt, x: x, y: y };
	},


	/* ::::: Mouse Trail ::::: */

	_trailSize: 0,
	_trailColor: "",
	_trailZoom: 1,
	_trailDot: null,
	_trailArea: null,
	_trailLastDot: null,
	_trailOffsetX: 0,
	_trailOffsetY: 0,

	_createTrail: function FGR__createTrail(aData) {
		let win = content.window;
		let doc = content.document;
		this._trailSize  = aData.size;
		this._trailColor = aData.color;
		this._trailZoom  = aData.zoom;
		this._trailOffsetX = (win.mozInnerScreenX - win.scrollX) * this._trailZoom;
		this._trailOffsetY = (win.mozInnerScreenY - win.scrollY) * this._trailZoom;
		this._trailArea = doc.createElementNS(HTML_NS, "xdTrailArea");
		(doc.documentElement || doc).appendChild(this._trailArea);
		this._trailDot = doc.createElementNS(HTML_NS, "xdTrailDot");
		this._trailDot.style.width = this._trailSize + "px";
		this._trailDot.style.height = this._trailSize + "px";
		this._trailDot.style.background = this._trailColor;
		this._trailDot.style.border = "0px";
		this._trailDot.style.position = "absolute";
		this._trailDot.style.zIndex = 2147483647;
	},

	_drawTrail: function FGR__drawTrail(aData) {
		if (!this._trailArea)
			return;
		let x1 = aData.x1, y1 = aData.y1, x2 = aData.x2, y2 = aData.y2;
		let xMove = x2 - x1;
		let yMove = y2 - y1;
		let xDecrement = xMove < 0 ? 1 : -1;
		let yDecrement = yMove < 0 ? 1 : -1;
		x2 -= this._trailOffsetX;
		y2 -= this._trailOffsetY;
		if (Math.abs(xMove) >= Math.abs(yMove))
			for (let i = xMove; i != 0; i += xDecrement)
				this._strokeDot(x2 - i, y2 - Math.round(yMove * i / xMove));
		else
			for (let i = yMove; i != 0; i += yDecrement)
				this._strokeDot(x2 - Math.round(xMove * i / yMove), y2 - i);
	},

	_eraseTrail: function FGR__eraseTrail() {
		if (this._trailArea && this._trailArea.parentNode) {
			while (this._trailArea.lastChild)
				this._trailArea.removeChild(this._trailArea.lastChild);
			this._trailArea.parentNode.removeChild(this._trailArea);
		}
		this._trailDot = null;
		this._trailArea = null;
		this._trailLastDot = null;
	},

	_strokeDot: function FGR__strokeDot(x, y) {
		if (this._trailArea.y == y && this._trailArea.h == this._trailSize) {
			// draw vertical line
			let newX = Math.min(this._trailArea.x, x);
			let newW = Math.max(this._trailArea.x + this._trailArea.w, x + this._trailSize) - newX;
			this._trailArea.x = newX;
			this._trailArea.w = newW;
			this._trailLastDot.style.left  = newX.toString() + "px";
			this._trailLastDot.style.width = newW.toString() + "px";
			return;
		}
		else if (this._trailArea.x == x && this._trailArea.w == this._trailSize) {
			// draw horizontal line
			let newY = Math.min(this._trailArea.y, y);
			let newH = Math.max(this._trailArea.y + this._trailArea.h, y + this._trailSize) - newY;
			this._trailArea.y = newY;
			this._trailArea.h = newH;
			this._trailLastDot.style.top    = newY.toString() + "px";
			this._trailLastDot.style.height = newH.toString() + "px";
			return;
		}
		if (this._trailZoom != 1) {
			x = Math.floor(x / this._trailZoom);
			y = Math.floor(y / this._trailZoom);
		}
		let dot = this._trailDot.cloneNode(true);
		dot.style.left = x + "px";
		dot.style.top = y + "px";
		this._trailArea.x = x;
		this._trailArea.y = y;
		this._trailArea.w = this._trailSize;
		this._trailArea.h = this._trailSize;
		this._trailArea.appendChild(dot);
		this._trailLastDot = dot;
	},

};

FireGesturesRemote.init();

