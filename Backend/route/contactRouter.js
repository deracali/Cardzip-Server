import express from "express";
import { saveContact, getContact } from "../controller/contactController.js";

const contactRoute = express.Router();

contactRoute.post("/save", saveContact); // Creates OR Updates
contactRoute.get("/get", getContact);       // Returns the single contact

export default contactRoute;
