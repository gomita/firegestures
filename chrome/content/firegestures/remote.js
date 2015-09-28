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
		addMessageListener("FireGestures:SwipeGesture", this);
		addMessageListener("FireGestures:DoCommand", this);
		addMessageListener("FireGestures:SendKeyEvent", this);
	},

	receiveMessage: function FGR_receiveMessage(aMsg) {
		// log("receiveMessage: " + aMsg.name + "\t" + aMsg.data.toSource());	// #debug
		switch (aMsg.name) {
			case "FireGestures:GestureStart"    : this._onGestureStart(aMsg.data); break;
			case "FireGestures:KeypressStart"   : this._onKeypressStart(); break;
			case "FireGestures:KeypressProgress": this._onKeypressProgress(aMsg.data); break;
			case "FireGestures:KeypressStop"    : this._onKeypressStop(); break;
			case "FireGestures:SwipeGesture"    : this._onSwipeGesture(aMsg.data); break;
			case "FireGestures:DoCommand"   : this._doCommand(aMsg.data); break;
			case "FireGestures:SendKeyEvent": this._sendKeyEvent(aMsg.data); break;
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
		let { doc, elt } = this._elementFromPoint(aData.x, aData.y);
		if (aData.type != "MozSwipeGesture" && aData.button == 0) {
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
		let sel = this._getSelectedText(doc, elt);
		sendRpcMessage("FireGesturesRemote:Response", { name: "sourceNode" }, { elt, sel });
	},

	_onSwipeGesture: function(aData) {
		log("onSwipeGesture: " + aData.toSource());	// #debug
		let { doc, elt } = this._elementFromPoint(aData.x, aData.y);
		let sel = this._getSelectedText(doc, elt);
		sendRpcMessage("FireGesturesRemote:Response", { name: "sourceNode" }, { elt, sel });
		sendSyncMessage("FireGesturesRemote:Response", { name: "swipe" }, { direction: aData.direction });
	},

	_getSelectedText: function(doc, elt) {
		// @see BrowserUtils.getSelectionDetails
		let sel = doc.defaultView.getSelection().toString();
		if (!sel && elt instanceof Ci.nsIDOMNSEditableElement) {
			if (elt instanceof Ci.nsIDOMHTMLTextAreaElement || 
			    (elt instanceof Ci.nsIDOMHTMLInputElement && elt.mozIsTextField(true))) {
				sel = elt.editor.selection.toString();
			}
		}
		return sel;
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
		let { doc, elt } = this._elementFromPoint(aData.x, aData.y);
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

	_doCommand: function FGR__doCommand(aData) {
		if (docShell.isCommandEnabled(aData.cmd))
			docShell.doCommand(aData.cmd);
	},

	_sendKeyEvent: function FGR__sendKeyEvent(aOptions) {
		let { doc, elt } = this._elementFromPoint(this._startX, this._startY);
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
		return { doc, elt };
	},


};

FireGesturesRemote.init();

