import React from "react";
import AOS from "aos";
import "aos/dist/aos.css";
import "./app.css";

AOS.init({
  duration: 800,   // animation length
  once: true,      // animate only once
  offset: 50,      // start a little before the element hits viewport
});


const e = React.createElement;

function MissionLabel({ text }) {
  return e("p", { className: "overlay__missionLabel" }, text);
}

function MissionCopy({ text }) {
  return e("p", { className: "overlay__missionText" }, text);
}

function CtaButton({ label, href = "mailto:david@abundance.company", onClick }) {
  return e(
    "a", { "data-aos": "fade-up", "data-aos-delay": "200" },
    {
      className: "overlay__cta",
      href,
      rel: "noopener noreferrer",
      onClick,
    },
    label
  );
}


function MissionSection({ label, copy }) {
  return e(
    "section",  { "data-aos": "fade-up" },
    { className: "overlay__mission" },
    e(MissionLabel, { text: label }),
    e(MissionCopy, { text: copy })
  );
}

function OverlayTitle() {
  return e(
    "div",
    {
      className: "overlay__hero",
    },
    e("h1", { className: "overlay__title" }, "Abundance")
  );
}

function OverlayContent() {
  return e(
    "div",
    { className: "overlay__content" },
    e(OverlayTitle),
    e("div", { className: "overlay__spacer" }),
    e(
      "div",
      { className: "overlay__stack" },
      e(MissionSection, {
        label: "Our Mission",
        copy: "To create abundance for everyone",
      }),
      e(CtaButton, { label: "Contact Us", href: "mailto:david@abundance.company" })
    )
  );
}


function App() {
  return e("div", { className: "overlay" }, e(OverlayContent));
}

export default App;

