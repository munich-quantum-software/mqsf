const colorScheme = matchMedia("(prefers-color-scheme: light)");
function updateTheme() {
  document.documentElement.dataset.theme = colorScheme.matches ? "light" : "dark";
}
colorScheme.addEventListener("change", updateTheme);
updateTheme();

const pitchPresentations = [
  "Raphael Seidel — DetectorExperiment: Streamlined QEC on IQM Hardware with a Built-In Path to Real-Time Decoding",
  "Serban Cercelescu — Qubitserf",
  "Mathys Rennela — Catching Bugs in Detector Error Models (Before Your Decoder Fails)",
  "Joel Arvid Sandås, Matteo Robbiati, Axel Andersson — The Chalmers Calibration Toolkit for Superconducting Quantum Processors",
  "Dimitrios Bantounas, Michael Fromm, Alexander Gresch, Ioannis Kizilis, Soronzonbold Otgonbaatar — Hardware-Native Compilation for Trapped-Ion Quantum Computing",
  "Oliver Denninger — The FullStaQD Reference Architecture for the Quantum Software Stack",
  "Cherilyn Christen, Nathaniel Pacey — A Framework for Noisy Gate Execution Simulating Quantum Circuits",
  "Reinhard Stahn, Julian Farnsteiner, Enrique Naranjo Bejarano, Riccardo Romanello, Christroph Fleckenstein, Wolfgang Lechner — The QCC Compiler: Compiling to a RISC-V Quantum ISA with LLVM and MLIR",
  "Marvin Erdmann, Florian Geissler, Johannes Oberreuter — Application Driven Benchmarking with QUARK",
  "Brad Chase, Farrokh Labib — Clifft: A Simulator for Early Fault-Tolerant Quantum Computing",
  "Kevin Mato — Scaling Quantum Computing Using AI Supercomputing",
  "David da Costa, Thomas Keitzl, Elisabeth Lobe, Johannes Renkl, Gary Schmiedinghoff, Thomas Stehle, Lukas Windgätter — QCI Connect SDK: A Flexible Toolbox for Bringing Applications to Quantum Computers",
  "Sascha Heußen — Efficient Classical Simulation of Noisy QEC Circuitry",
  "Ronin Wu — Building Complete Gate-Level Quantum Lattice-Boltzmann Circuits Using QURI SDK's Structured Circuit-Construction Interface.",
  "Sören Wilkening, Lennart Binkowski — CQ - An LLVM IR Pass to Extend C to a Quantum Programming Language",
  "Giancarlo Ponte Gamberi; Alexander Mandl; Sonja Bruckner; Stefan Hillmich — Towards Automatic Distribution of Constraints into Cost and Mixer Hamiltonians",
  "Arthur Strauss, Clemens Müller — Qiskit Kernels for Real-Time Quantum-Classical Programs - The Qiskit Quantum Machines Provider",
  "Hemant Sharma, Jelena Mackeprang, Jonas Helsen — Fast Identification of Loss-Tolerant Teleportation Procedures in Quantum Error Correcting Codes",
  "Nils Quetschlich — Recent Advances toward Dynamic Circuit Support on Amazon Braket",
  "Paul K. Faehrmann, Peter-Jan Derks, Frederik Wilde, Johannes Frank — Piper Draw: An Interactive Tool for Building, Viewing, and Analyzing Lattice Surgery Pipe Diagrams",
  "Abhoy Kole, Till Schnittka, Karl Aaron Rudkowski, Julie Maria Raju, Majd Assaad, Louis Kruger, Rolf Drechsler — QCore: A Unified Quantum Software Framework from High-Level Specifications to Dynamic Compilation and Debugging",
  "Ekin Devrim Şahinkaya, Ercüment Kaya, Martin Schulz — OpenMQPI: MLIR-Based OpenMP Extension for Quantum Programming",
  "Rahul Banerjee, Sarah Volkamer, Dr. Daniel Scherer — Circuit-Cutting Module for Near-Term Quantum Computing",
  "Gabriele Palazzo — Quantum Machine Learning with the Open-Source Qibo Stack: From Simulation to Hardware",
  "Satoyuki Tsukano, Naoyuki Masumoto, Bin Matsui, Kosuke Miyaji, Takafumi Miyanaga, and Toshio Mori — OQTOPUS: An Extensible Full-Stack Platform for Quantum Computing",
  "Artemiy Burov — Computing NMR Spectra on Quantum Computers",
  "Zsolt Szabó, Sina Gholizadeh, Samuel Elman, Alan Robertson, Simon Devitt — QLDPC Architect: Hardware-Aware Implementation of qLDPC Codes",
  "Aleksandra Swierkowska, Emmanouil Giortamis, Jannik Pflieger, Felix Gust, Pramod Bhatotia — ECCentric: A Benchmarking Framework for Quantum Error Correction Codes",
  "Takafumi Miyanaga, Taiki Fujita, Naoyuki Masumoto, Bin Matsui, Kosuke Miyaji, Toshio Mori, and Satoyuki Tsukano — QDash: Managing Calibration Workflows and Engineering Knowledge for Quantum Processors",
  "Giuseppe Bisicchia, Alessandro Bocci, Antonio Brogi — StableShots: Auditable Adaptive Shot Control for Quantum Circuit Runtimes",
  "Giuseppe Bisicchia, Alessandro Bocci, Antonio Brogi — QSOL: A Specification-Oriented Compiler for Quantum Optimization Models",
  "Fujitsu Research of Europe team — Fujitsu QARP: One Package from Research Idea to Quantum Hardware",
  "Ashutosh Mishra — ParaQeet: A Quantum Optimal Control Toolkit with Simple Parameter Management",
  "Domenik Eichhorn, Nick Poser, Maximilian Schweikart, Piotr Malkowski, Luke Southall — Hybrid Quantum / Classical Problem Solving with the ProvideQ Toolbox",
  "Milad Ghadimi — QuDecide: A Framework for Benchmarking Quantum Optimization against Classical Baselines",
  "Edward Stow, Adam Melvin, Adrien Suau, Luca Huelle, Daoyi Chen, Victoria Holodovsky, Davide Sonno, Ryan Dancy, Kiran Amin, Zalan Nemeth, and Sara Metwalli — Deltakit-compile Featuring Circuit Builder: An MLIR-Based Framework for Designing Quantum Error Correcting Codes.",
  "Florian Krötz — Paulib – A High-Performance Framework for Pauli Algebra",
  "Ralf Ramsauer, Lukas Landgraf, Wolfgang Mauerer — QPX: An Open Research Platform for Quantum Control Architectures",
  "Adam Godel, Adrian Acosta, Maggie Bao, Connor Howe, Sarah Chehade, Vardaan Sahgal, Joan Étude Arrow, and Brian J. McDermott — QuantumBenchPhase: A Quantum Simulation and Benchmarking Library for Generating Phase Diagrams",
  "Ondřej Lengál — MilQ: Gate-Optimal Synthesis of Quantum Circuits",
  "Mateo Uldemolins, Pranav Nair, Maxime Garnier, and Thierry Martinez — Graphix: An Open-Source Toolkit for Measurement-Based Quantum Computation",
  "Vladyslav Los, Patrick Lenggenhager, Maciej Koch-Janusz — Modular EFTQC Compilation and Simulation Framework",
  "Diego Alberto Olvera Millán — QAdaptive: A Flexible Framework for Training Adaptive Quantum Circuits †",
  "David Plankensteiner, Xiu-Zhe Luo, Kai-Hsin Wu, Neelay Fruitwala, Alexander Schuckert, Oriol Rubies-Bigorda, Rafael Haenel, Refaat Ismail, Stefan Ostermann, Shengtao Wang — PPVM - Efficient, Generic Framework for Realistic Hardware Emulation with Classical Logic",
];

const pitchCards = document.querySelectorAll(".pitch-card");
const pitchSessionStarts = [0, 11, 22, 33];
let nextPitchNumber = 1;

pitchCards.forEach((card) => {
  const session = Number(card.dataset.pitchSession);
  const presentations = pitchPresentations.slice(pitchSessionStarts[session], pitchSessionStarts[session + 1]);
  const list = card.querySelector(".pitch-list");
  const toggle = card.querySelector(".pitch-toggle");

  list.start = nextPitchNumber;
  card.classList.add("is-expanded");
  card.setAttribute("aria-expanded", "true");
  list.hidden = false;
  toggle.textContent = "Hide presentations";

  presentations.forEach((presentation) => {
    const item = document.createElement("li");
    const separator = presentation.indexOf(" — ");
    const authors = presentation.slice(0, separator);
    const title = presentation.slice(separator + 3);
    const authorLine = document.createElement("strong");
    const titleLine = document.createElement("span");

    authorLine.textContent = authors;
    titleLine.textContent = title;
    item.append(authorLine, titleLine);
    list.append(item);
  });
  nextPitchNumber += presentations.length;

  const togglePitchList = () => {
    const isExpanded = card.getAttribute("aria-expanded") === "true";
    card.setAttribute("aria-expanded", String(!isExpanded));
    card.classList.toggle("is-expanded", !isExpanded);
    list.hidden = isExpanded;
    toggle.textContent = isExpanded ? "View presentations" : "Hide presentations";
  };

  card.addEventListener("click", togglePitchList);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      togglePitchList();
    }
  });
});

document.querySelectorAll(".speaker-card").forEach((card) => {
  const details = card.querySelector(".speaker-details");

  const toggleSpeakerDetails = () => {
    const isExpanded = card.getAttribute("aria-expanded") === "true";
    card.setAttribute("aria-expanded", String(!isExpanded));
    card.classList.toggle("is-expanded", !isExpanded);
    details.hidden = isExpanded;
  };

  card.addEventListener("click", (event) => {
    if (!event.target.closest("a")) {
      toggleSpeakerDetails();
    }
  });
  card.addEventListener("keydown", (event) => {
    if (!event.target.closest("a") && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      toggleSpeakerDetails();
    }
  });
});

const programLinks = document.querySelectorAll("[data-view]");

function updateProgramNavigation() {
  const target = document.getElementById(location.hash.slice(1));
  const section = target?.closest(".day-schedule, #side-events");
  const selectedId = section?.id || (location.hash ? null : "day-1");
  programLinks.forEach(link => {
    const selected = link.dataset.view === selectedId;
    link.classList.toggle("is-active", selected);
    if (selected) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
}

window.addEventListener("hashchange", updateProgramNavigation);
updateProgramNavigation();
