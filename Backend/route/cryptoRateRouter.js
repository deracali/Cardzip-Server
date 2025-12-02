import express from 'express';
import {
    bulkUpdateRates,
    createRate,
    deleteRate,
    getAllRates,
    getRateBySymbol,
    updateRate
} from '../controller/cryptoRateController.js';

const CryptoRateRouter = express.Router();

CryptoRateRouter.get('/get', getAllRates);  // get in di
CryptoRateRouter.get('/get/:symbol', getRateBySymbol);
 CryptoRateRouter.post('/create', createRate);   // only form 
CryptoRateRouter.put('/update/:symbol', updateRate);  /// e.g., /update/BTC
CryptoRateRouter.delete('/delete/:symbol', deleteRate); // e.g., /delete/BTC
CryptoRateRouter.put('/update-bulk', bulkUpdateRates);

export default CryptoRateRouter;
