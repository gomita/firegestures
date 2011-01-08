//////////////////////////////////////////////////
// global

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

// aliases
var gArg;
var gNameTextbox;
var gCommandTextbox;
var gScriptTextbox;
var gDirectionTextbox;


//////////////////////////////////////////////////
// EditUI

var EditUI = {

	// xdIGestureHandler
	_gestureHandler: null,

	init: function() {
		gArg = window.arguments[0];
		gNameTextbox      = document.getElementById("gestureName");
		gCommandTextbox   = document.getElementById("gestureCommand");
		gScriptTextbox    = document.getElementById("gestureScript");
		gDirectionTextbox = document.getElementById("gestureDirection");
		// set the initial values
		gNameTextbox.value = gArg.name;
		gDirectionTextbox.value = gArg.direction;
		// script-type gestures
		if (gArg.type == Ci.xdIGestureMapping.TYPE_SCRIPT) {
			gScriptTextbox.value = gArg.command;
			gCommandTextbox.parentNode.hidden = true;
			document.getElementById("drawArea").style.height = "200px";
		}
		// normal gestures
		else {
			gCommandTextbox.value = gArg.command;
			gScriptTextbox.parentNode.hidden = true;
			gNameTextbox.readOnly = true;
			gDirectionTextbox.select();
		}
		// xdIGestureHandler
		var gestureSvc = Cc["@xuldev.org/firegestures/service;1"].getService(Ci.xdIGestureService);
		this._gestureHandler = gestureSvc.createHandler();
		this._gestureHandler.attach(document.getElementById("drawArea"), this);
	},

	uninit: function() {
		// xdIGestureHandler
		if (this._gestureHandler) {
			this._gestureHandler.detach();
			this._gestureHandler = null;
		}
	},

	accept: function() {
		// test the direction
		// allow only empty string and a string which consists of inconsecutive LRUD chars
		if (!/^[LRUD]*$/.test(gDirectionTextbox.value) || /(?:LL|RR|UU|DD)/.test(gDirectionTextbox.value)) {
			gDirectionTextbox.select();
			return false;
		}
		if (gArg.type == Ci.xdIGestureMapping.TYPE_SCRIPT) {
			// test the script syntax
			try {
				new Function("event", gScriptTextbox.value);
			}
			catch(ex) {
				var bundle = window.opener.document.getElementById("bundleMain");
				var msg = bundle.getString("INVALID_SCRIPT") + "\n" + ex;
				window.opener.PrefsUI.promptSvc.alert(window, "FireGestures", msg);
				return false;
			}
			gArg.name    = gNameTextbox.value;
			gArg.command = gScriptTextbox.value;
		}
		gArg.direction = gDirectionTextbox.value;
		gArg.accepted = true;
		return true;
	},


	/* ::::: xdIGestureObserver ::::: */

	onDirectionChanged: function(event, aDirection) {
		gDirectionTextbox.value = aDirection;
	},

	onMouseGesture: function(event, aDirection) {},
	onExtraGesture: function(event, aGesture) {},

};


